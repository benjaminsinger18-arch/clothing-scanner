// Wraps the Claude Messages API for garment classification. Uses tool-forced
// structured output (rather than parsing free text) so the response always
// matches ClassificationResult's shape.

import Anthropic from "@anthropic-ai/sdk";
import {
  UNRECOGNIZED_GARMENT,
  type BrandConfidence,
  type ClassificationResult,
} from "@clothing-scanner/shared-types";
import type { SupportedMediaType } from "../lib/imageUtils.js";
import { CLASSIFICATION_JSON_SCHEMA, CLASSIFICATION_PROMPT, type RawClassification } from "../lib/classificationSchema.js";
import { getVisionSignal, type VisionSignal } from "./visionClient.js";
import { classifyWithGemini } from "./geminiClient.js";
import type { UpcItem } from "./upcClient.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-5";
const GEMINI_MODEL_LABEL = "gemini-3.1-pro";
const CLASSIFY_TOOL_NAME = "report_classification";
const OUTFIT_TOOL_NAME = "report_outfit_suggestions";

export class ClassificationError extends Error {}

let anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ClassificationError(
        "ANTHROPIC_API_KEY is not set — copy server/.env.example to server/.env and fill it in"
      );
    }
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

const classifyTool: Anthropic.Tool = {
  name: CLASSIFY_TOOL_NAME,
  description: "Report the structured classification of a piece of clothing shown in a photo.",
  // Shared with geminiClient.ts's response_format.schema — see classificationSchema.ts
  // for why (keeps both providers' outputs directly comparable/mergeable).
  input_schema: CLASSIFICATION_JSON_SCHEMA as unknown as Anthropic.Tool["input_schema"],
};

interface ClassifyOptions {
  imageBase64: string;
  mediaType: SupportedMediaType;
  /** Optional best-guess description from Google Cloud Vision, offered as a hint on
   * the retry pass after Claude's first pass came back unrecognized. Vision itself
   * now always runs (see classifyImage), concurrently with the first pass — this
   * field is still only ever attached to the second/rescue call, never the first,
   * since Vision hasn't resolved yet at the moment the first call fires. */
  hint?: string;
}

async function callClaude(model: string, opts: ClassifyOptions): Promise<RawClassification> {
  const hintText = opts.hint
    ? ` A separate image-recognition system's best guess for this photo is "${opts.hint}" — treat that ` +
      "as a hint, not ground truth: weigh it against what you actually see, and still call " +
      "report_classification with garmentType set to \"unrecognized\" if the hint doesn't hold up either."
    : "";

  const response = await getClient().messages.create({
    model,
    max_tokens: 512,
    tools: [classifyTool],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: opts.mediaType, data: opts.imageBase64 } },
          {
            type: "text",
            text:
              "Identify the piece of clothing in this photo and call report_classification with your " +
              "best assessment. " +
              CLASSIFICATION_PROMPT +
              hintText,
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === CLASSIFY_TOOL_NAME
  );
  if (!toolUse) {
    throw new ClassificationError("Claude did not return a structured classification");
  }
  return toolUse.input as RawClassification;
}

async function callClaudeWithRetry(model: string, opts: ClassifyOptions): Promise<RawClassification> {
  try {
    return await callClaude(model, opts);
  } catch (err) {
    console.warn(`[claudeClient] ${model} call failed, retrying once:`, err);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await callClaude(model, opts);
  }
}

/** Post-hoc merge of secondary brand opinions into a primary result. Only fills
 * in/upgrades the brand guess when the primary result itself was unconfident
 * (none/low) — a confident primary guess (medium/high) is left untouched, since
 * it's already vetted against the actual image context and neither secondary
 * source has been. Priority when the primary is unconfident: Gemini's own
 * independent classification (a full reasoned second opinion) over Vision's logo
 * detection (a raw entity match with no holistic reasoning) — Gemini only wins
 * when it itself reported medium/high brand confidence, softened one notch on the
 * way in (high→medium, medium→low) since it's still an opinion the primary model
 * didn't itself corroborate. Vision's logo guess is always forced to "low"
 * regardless of its own score, same as before. Either case tags brandSource so
 * this is never conflated with the primary model's own guess. */
function applyBrandCrossValidation(
  primary: RawClassification,
  gemini: RawClassification | null,
  vision: VisionSignal | null
): RawClassification & { brandSource?: "vision-logo" | "gemini" } {
  if (primary.brandConfidence !== "none" && primary.brandConfidence !== "low") return primary;

  if (gemini?.brandGuess && (gemini.brandConfidence === "medium" || gemini.brandConfidence === "high")) {
    return {
      ...primary,
      brandGuess: gemini.brandGuess,
      brandConfidence: gemini.brandConfidence === "high" ? "medium" : "low",
      brandSource: "gemini",
    };
  }

  if (vision && vision.logos.length > 0) {
    return {
      ...primary,
      brandGuess: vision.logos[0].description,
      brandConfidence: "low",
      brandSource: "vision-logo",
    };
  }

  return primary;
}

/**
 * Classifies a garment photo using Sonnet. Retries once on transient
 * failure; throws ClassificationError if the retried call also fails, since
 * nothing downstream can proceed without a base classification.
 *
 * Previously used Haiku by default, escalating to a second, sequential
 * Sonnet call whenever brand confidence came back "low" on a recognized
 * item. The two-call escalation was dropped for latency (doubled classify
 * time on a large share of scans); that in turn freed up enough latency
 * budget to just use Sonnet for the single call outright, trading Haiku's
 * speed/cost for accuracy across the board (not just brand guesses) per
 * user request — still one round-trip, so the overall time budget holds.
 * That constraint still holds here: exactly one Claude call happens on the
 * common (recognized) path below, same as before — Gemini is a second,
 * independent *provider* call, not a second Claude call, so it doesn't
 * reintroduce the thing that constraint was protecting against.
 *
 * Google Cloud Vision and Gemini both now run as always-on ensemble signals
 * alongside that one Claude call — all fired concurrently, not sequentially,
 * so neither delays Claude's first call. Vision is fast enough that awaiting
 * it after Claude resolves is expected to add ~zero latency; Gemini is a full
 * reasoning model like Claude itself and may genuinely take comparable or
 * longer to resolve, so it CAN add real latency on the common path (bounded
 * by geminiClient's own timeout) — this is a real tradeoff, not a free one
 * like Vision's slot in this design.
 *
 * The two-provider signal is used three ways:
 *   1. Brand cross-validation (applyBrandCrossValidation, above) — either
 *      secondary source can catch a brand Claude was too conservative to
 *      name, on any result.
 *   2. Unrecognized-item rescue via Gemini (new, tried first) — if Claude's
 *      first pass can't name the item at all, and Gemini's own independent
 *      pass *can*, Gemini's full result is used directly — stronger recovery
 *      than a hint, since it's Gemini's own reasoned classification rather
 *      than Claude reconsidering with a fragment of context.
 *   3. Unrecognized-item rescue via Vision hint (existing fallback, now last
 *      resort) — only tried if Gemini also couldn't identify it (or isn't
 *      configured): Vision's web/label best guess seeds a hint for one retry
 *      Claude call, exactly as before.
 * Each provider degrades silently and independently if unconfigured/erroring —
 * with neither Gemini nor Vision available, this is exactly Claude-alone
 * behavior.
 */
export async function classifyImage(opts: ClassifyOptions): Promise<ClassificationResult> {
  // Fire all three immediately, in parallel. Both helpers already catch their own
  // errors internally and resolve null rather than throwing, but wrap defensively
  // anyway so a future change to either contract can't take classifyImage down.
  const visionPromise = getVisionSignal(opts.imageBase64).catch(() => null);
  const geminiPromise = classifyWithGemini(opts.imageBase64, opts.mediaType).catch(() => null);

  // Claude's first pass does NOT wait on either — it can't, since neither has
  // resolved yet at this point (they all started together).
  const first = await callClaudeWithRetry(SONNET_MODEL, opts);

  if (first.garmentType !== UNRECOGNIZED_GARMENT) {
    // Common path: Claude already has an answer. Await both concurrently-started
    // promises — Vision is typically already resolved (near-instant); Gemini may
    // not be (see the latency note above).
    const [vision, gemini] = await Promise.all([visionPromise, geminiPromise]);
    const merged = applyBrandCrossValidation(first, gemini, vision);
    return { ...merged, model: "claude-sonnet-5" };
  }

  // Claude couldn't identify it. Try Gemini's own independent answer first — a
  // full second opinion beats a single-phrase hint fed back to Claude.
  const gemini = await geminiPromise;
  if (gemini && gemini.garmentType !== UNRECOGNIZED_GARMENT) {
    const vision = await visionPromise;
    // Gemini is primary here, so no gemini opinion left to cross-validate against
    // (would be comparing it to itself) — only Vision can still add a brand signal
    // on top of Gemini's own.
    const merged = applyBrandCrossValidation(gemini, null, vision);
    return { ...merged, model: GEMINI_MODEL_LABEL };
  }

  // Gemini also couldn't identify it (or isn't configured) — fall back to the
  // existing Vision-hint rescue as a last resort. Reuses the same already-in-flight
  // Vision promise (it had a head start from launching concurrently).
  const vision = await visionPromise;
  if (!vision) {
    return { ...first, model: "claude-sonnet-5" };
  }

  // Prefer Vision's general scene guess for the rescue hint; if web/label detection
  // came up empty but a logo was found, fall back to a logo-derived hint.
  const hintText = vision.bestGuess ?? (vision.logos[0] ? `a logo matching "${vision.logos[0].description}"` : null);
  if (!hintText) {
    return { ...first, model: "claude-sonnet-5" };
  }

  const retried = await callClaudeWithRetry(SONNET_MODEL, { ...opts, hint: hintText });
  const merged = applyBrandCrossValidation(retried, null, vision);
  return {
    ...merged,
    model: "claude-sonnet-5",
    visionAssisted: retried.garmentType !== UNRECOGNIZED_GARMENT,
  };
}

/**
 * Normalizes a UPCitemdb barcode match into a full ClassificationResult. Text-only
 * (no image — none is available for a barcode scan), so it's cheap — always uses
 * Haiku, same as suggestOutfitPairings. Reuses the exact same classifyTool object
 * classifyImage's photo path uses, so there's no second schema to keep in sync.
 *
 * Unlike a photo classification, brandGuess/brandConfidence are NOT trusted from
 * the model's own output here — they're post-processed straight from the barcode's
 * own `brand` field, forced to "high" confidence and brandSource: "barcode", since
 * an exact UPC match is strictly more authoritative than any model self-report of
 * it (same never-trust-the-model's-own-confidence principle applyBrandCrossValidation
 * uses for Vision/Gemini brand signals, just inverted — here the non-model source
 * wins outright rather than only filling a gap). garmentType/category/pattern/style
 * are genuine model inference from the sparse title/description text, since the
 * barcode database has no structured data for those.
 */
export async function classifyFromBarcode(item: UpcItem): Promise<ClassificationResult> {
  const raw = await callBarcodeClassificationWithRetry(item);
  return {
    ...raw,
    brandGuess: item.brand ?? raw.brandGuess,
    brandConfidence: item.brand ? "high" : "none",
    brandSource: item.brand ? "barcode" : undefined,
    model: "claude-haiku-4-5",
    source: "barcode",
  };
}

async function callBarcodeClassification(item: UpcItem): Promise<RawClassification> {
  const details = [
    `Title: "${item.title}"`,
    item.brand ? `Brand: "${item.brand}"` : null,
    item.color ? `Color: "${item.color}"` : null,
    item.category ? `Database category: "${item.category}"` : null,
    item.description ? `Description: "${item.description}"` : null,
  ]
    .filter(Boolean)
    .join(". ");

  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    tools: [classifyTool],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL_NAME },
    messages: [
      {
        role: "user",
        content:
          "A barcode scan matched this clothing product's database listing — no photo is available, " +
          "text only. Treat the fields below as reliable ground truth, not things to second-guess the way " +
          "you would from a photo: " +
          details +
          ". Map the database category into the required category enum as best you can. Only garmentType, " +
          "pattern, and style require genuine inference from this sparse text — say your honest best guess " +
          "rather than \"unknown\" where the text doesn't pin it down exactly. Call report_classification " +
          "with your best structured assessment. " +
          CLASSIFICATION_PROMPT,
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === CLASSIFY_TOOL_NAME
  );
  if (!toolUse) {
    throw new ClassificationError("Claude did not return a structured classification for the barcode match");
  }
  return toolUse.input as RawClassification;
}

async function callBarcodeClassificationWithRetry(item: UpcItem): Promise<RawClassification> {
  try {
    return await callBarcodeClassification(item);
  } catch (err) {
    console.warn("[claudeClient] barcode classification call failed, retrying once:", err);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await callBarcodeClassification(item);
  }
}

const outfitTool: Anthropic.Tool = {
  name: OUTFIT_TOOL_NAME,
  description: "Report 3-5 complementary clothing items that would pair well with the given item as an outfit.",
  input_schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            keywords: {
              type: "string",
              description:
                'Short, search-friendly keyword phrase for the complementary item, e.g. "navy chino pants" ' +
                'or "white leather sneakers" — not a full sentence, and not a restatement of the item itself.',
            },
          },
          required: ["keywords"],
        },
      },
    },
    required: ["suggestions"],
  },
};

export interface OutfitPairingInput {
  garmentType: string;
  category: string;
  color: string;
  pattern: string;
  style: string;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}

function describeItem(input: OutfitPairingInput): string {
  const brandPart =
    input.brandGuess && (input.brandConfidence === "medium" || input.brandConfidence === "high")
      ? ` (possibly ${input.brandGuess})`
      : "";
  const patternPart = input.pattern && input.pattern.toLowerCase() !== "none" ? `${input.pattern} ` : "";
  return `${input.color} ${patternPart}${input.garmentType}${brandPart}, style: ${input.style}, category: ${input.category}`;
}

async function callOutfitSuggestions(input: OutfitPairingInput): Promise<string[]> {
  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    tools: [outfitTool],
    tool_choice: { type: "tool", name: OUTFIT_TOOL_NAME },
    messages: [
      {
        role: "user",
        content:
          `Suggest 3-5 clothing items that would pair well as an outfit with this item: ${describeItem(input)}. ` +
          "Call report_outfit_suggestions with short, search-friendly keyword phrases suitable for a product search.",
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === OUTFIT_TOOL_NAME
  );
  if (!toolUse) {
    throw new ClassificationError("Claude did not return outfit suggestions");
  }

  const result = toolUse.input as { suggestions: { keywords: string }[] };
  return result.suggestions.map((s) => s.keywords).filter(Boolean);
}

/** Suggests 3-5 search-ready keyword phrases for items that would complement the
 * given garment. Text-only (no image), so it's cheap — always uses Haiku. Retries
 * once on transient failure; throws on a second failure, since the outfit-suggestions
 * endpoint has nothing useful to return without this. */
export async function suggestOutfitPairings(input: OutfitPairingInput): Promise<string[]> {
  try {
    return await callOutfitSuggestions(input);
  } catch (err) {
    console.warn("[claudeClient] outfit suggestion call failed, retrying once:", err);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await callOutfitSuggestions(input);
  }
}
