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
import { getVisionSignal, type VisionSignal } from "./visionClient.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-5";
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
  input_schema: {
    type: "object",
    properties: {
      garmentType: {
        type: "string",
        description:
          `Specific garment type, e.g. "denim jacket", "graphic t-shirt", "chino pants". ` +
          `If the image does not clearly show a single wearable clothing item (wrong subject, ` +
          `too blurry/dark to tell), set this to exactly "${UNRECOGNIZED_GARMENT}".`,
      },
      category: {
        type: "string",
        enum: ["tops", "bottoms", "outerwear", "dresses", "footwear", "accessories", "activewear", "underwear-sleepwear"],
        description: "Broad category the garment belongs to — pick the single best fit.",
      },
      color: { type: "string", description: 'Dominant color(s), e.g. "navy blue".' },
      pattern: { type: "string", description: 'e.g. "solid", "striped", "floral", "plaid", "none".' },
      style: { type: "string", description: 'e.g. "casual", "formal", "streetwear", "vintage".' },
      brandGuess: {
        type: ["string", "null"],
        description:
          "Best-effort brand guess based on visible logos/labels/stitching/hardware. " +
          "Null if there is no reasonable basis for a guess.",
      },
      brandConfidence: {
        type: "string",
        enum: ["none", "low", "medium", "high"],
        description: "Your honest confidence in brandGuess — do not inflate this.",
      },
    },
    required: ["garmentType", "category", "color", "pattern", "style", "brandGuess", "brandConfidence"],
  },
};

interface RawClassification {
  garmentType: string;
  category: string;
  color: string;
  pattern: string;
  style: string;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}

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
              "best assessment. Look closely at the garment's cut, construction, and details before " +
              "naming its specific type, and judge its true dominant color as it actually appears in " +
              "the photo's lighting. Be honest about uncertainty — do not guess a brand you can't " +
              "reasonably support from visible evidence." +
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

/** Post-hoc merge of Vision's logo detection into a Claude result. Only fills in/
 * upgrades the brand guess when Claude itself was unconfident (none/low) — a
 * confident Claude brand guess (medium/high) is left untouched, since it's already
 * vetted against the actual image context and Vision's logo match hasn't been.
 * Forces brandConfidence to "low" on any Vision-sourced guess regardless of
 * Vision's own score, and tags brandSource so this is never conflated with a
 * Claude-vouched guess. */
function applyVisionBrandSignal(
  result: RawClassification,
  vision: VisionSignal | null
): RawClassification & { brandSource?: "vision-logo" } {
  if (!vision || vision.logos.length === 0) return result;
  if (result.brandConfidence !== "none" && result.brandConfidence !== "low") return result;

  return {
    ...result,
    brandGuess: vision.logos[0].description,
    brandConfidence: "low",
    brandSource: "vision-logo",
  };
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
 * common (recognized) path below, same as before.
 *
 * Google Cloud Vision now runs as an always-on ensemble signal alongside that
 * one Claude call — fired concurrently, not sequentially, so it never delays
 * the first Claude call and (since Vision's images:annotate call is typically
 * faster than a Sonnet vision call) adds ~zero latency to the common path: by
 * the time Claude resolves, Vision has usually already resolved too. It's used
 * two ways:
 *   1. Brand augmentation (applyVisionBrandSignal, above) — logo detection can
 *      catch a brand Claude was too conservative to name, on any result.
 *   2. Unrecognized-item rescue (unchanged in spirit from before, just cheaper
 *      to trigger) — if Claude's first pass can't name the item at all, Vision's
 *      web/label best guess seeds a hint for one retry Claude call. Since Vision
 *      started concurrently with the first Claude call rather than only after it
 *      failed, this pays less latency than the old sequential fallback did.
 * If GOOGLE_VISION_API_KEY isn't configured (or Vision errors/rate-limits/finds
 * nothing), this degrades silently to exactly Claude-alone behavior.
 */
export async function classifyImage(opts: ClassifyOptions): Promise<ClassificationResult> {
  // Fire both immediately, in parallel. getVisionSignal already catches its own
  // errors internally and resolves null rather than throwing, but wrap defensively
  // anyway so a future change to that contract can't take classifyImage down with it.
  const visionPromise = getVisionSignal(opts.imageBase64).catch(() => null);

  // Claude's first pass does NOT wait on Vision — it can't, since Vision hasn't
  // resolved yet at this point (they started together).
  const first = await callClaudeWithRetry(SONNET_MODEL, opts);

  if (first.garmentType !== UNRECOGNIZED_GARMENT) {
    // Common path: Claude already has an answer. Await the concurrently-started
    // Vision promise — by now it has typically already resolved, so this is
    // expected to be near-instant.
    const vision = await visionPromise;
    const merged = applyVisionBrandSignal(first, vision);
    return { ...merged, model: "claude-sonnet-5" };
  }

  // Unrecognized path: reuse the same already-in-flight Vision promise (it had a
  // head start from launching concurrently, instead of only starting now).
  const vision = await visionPromise;
  if (!vision) {
    return { ...first, model: "claude-sonnet-5" };
  }

  // Prefer Vision's general scene guess for the rescue hint; if web/label detection
  // came up empty but a logo was found, fall back to a logo-derived hint — new
  // value versus before, where only bestGuess could ever rescue a scan.
  const hintText = vision.bestGuess ?? (vision.logos[0] ? `a logo matching "${vision.logos[0].description}"` : null);
  if (!hintText) {
    return { ...first, model: "claude-sonnet-5" };
  }

  const retried = await callClaudeWithRetry(SONNET_MODEL, { ...opts, hint: hintText });
  const merged = applyVisionBrandSignal(retried, vision);
  return {
    ...merged,
    model: "claude-sonnet-5",
    visionAssisted: retried.garmentType !== UNRECOGNIZED_GARMENT,
  };
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
