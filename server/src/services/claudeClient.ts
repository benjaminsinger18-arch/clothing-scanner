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
import { canMakeWebSearchCall, recordWebSearchCall } from "../lib/rateLimitTracker.js";

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

// --- User-correction verification -----------------------------------------------
// Lets a user dispute a classification and type what the item actually is. Unlike
// every path above, the correction is checked against a real web search before
// being trusted — a raw re-guess (ours or the user's own unverified claim) isn't
// good enough for a "make sure it's actually right" feature.
//
// This has to be two Anthropic calls, not one: Anthropic's web_search tool is a
// server-side tool (the API runs the search itself and feeds results back to
// Claude within a single response), but per their docs, forcing tool_choice onto
// a client tool (like our classifyTool) in the same call preempts web_search
// entirely — Claude never gets the chance to search first. So:
//   1. Research — Claude + web_search, tool_choice left at default "auto" so
//      Claude can decide whether/how much to search, producing free text with
//      citations.
//   2. Structure — the same classifyFromBarcode pattern: Haiku, classifyTool
//      forced, text-only, given the research summary as input.
//
// Phase 1 is a raw fetch against the Anthropic REST API directly, NOT the SDK
// client this file otherwise uses everywhere else. server/package.json pins
// @anthropic-ai/sdk far behind current (0.32.x vs 0.123.x latest at time of
// writing) and 0.x semver carries no inter-minor stability guarantee — bumping it
// risked regressing classifyImage/classifyFromBarcode/suggestOutfitPairings for a
// feature that doesn't need the bump at all. visionClient.ts and upcClient.ts
// already establish the "raw fetch, no SDK" pattern in this codebase for exactly
// this situation.

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const WEB_SEARCH_TOOL_TYPE = "web_search_20250305";

export type ResearchResult =
  | { status: "ok"; summary: string; sources: { title: string; url: string }[] }
  | { status: "rate_limited" }
  | { status: "unavailable" };

export type CorrectionResult =
  | { status: "ok"; classification: ClassificationResult }
  | { status: "rate_limited" }
  | { status: "research_unavailable" }
  | { status: "structuring_failed"; reason: string };

function describeOriginalForCorrection(original: ClassificationResult): string {
  const brandPart =
    original.brandGuess && original.brandConfidence !== "none"
      ? ` (guessed brand: ${original.brandGuess}, confidence ${original.brandConfidence})`
      : "";
  const patternPart = original.pattern && original.pattern.toLowerCase() !== "none" ? `${original.pattern} ` : "";
  return `${original.color} ${patternPart}${original.garmentType}${brandPart}, category: ${original.category}, style: ${original.style}`;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
  citations?: { type: string; url?: string; title?: string }[];
}

async function callResearch(
  correctionText: string,
  original: ClassificationResult
): Promise<{ summary: string; sources: { title: string; url: string }[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClassificationError(
      "ANTHROPIC_API_KEY is not set — copy server/.env.example to server/.env and fill it in"
    );
  }

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      max_tokens: 1024,
      // No tool_choice here — left at the default "auto" on purpose, see the
      // block comment above this section for why forcing it would be a mistake.
      tools: [{ type: WEB_SEARCH_TOOL_TYPE, name: "web_search", max_uses: 4 }],
      messages: [
        {
          role: "user",
          content:
            `A user is correcting an AI clothing classification they believe is wrong. The system ` +
            `previously identified the item as: ${describeOriginalForCorrection(original)}. The user says: ` +
            `"${correctionText}". Research this on the web if it would help confirm the item's real garment ` +
            `type, category, color, pattern, style, or brand — search for the specific product/brand/model ` +
            `the user named if one is identifiable. Use your judgment about whether a search is actually ` +
            `needed. When done, write one clear, confident paragraph stating what this item actually is, ` +
            `covering garment type, category, color, pattern, style, and brand (with your honest confidence) ` +
            `— no meta-commentary about your search process, just the final factual summary.`,
        },
      ],
    }),
  });

  // Record right after a successful HTTP response, same granularity as
  // visionClient.ts/geminiClient.ts — counts this as one use against our own soft
  // cap regardless of whether Claude actually invoked web_search internally (it
  // may have judged no search was needed), same approximation those two make.
  recordWebSearchCall();

  if (!response.ok) {
    throw new ClassificationError(`Anthropic research call failed: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { content?: unknown[] };
  const textBlocks = (json.content ?? []).filter(
    (b): b is AnthropicTextBlock => (b as { type?: string }).type === "text"
  );
  const summary = textBlocks.map((b) => b.text).join("\n\n").trim();

  const sources: { title: string; url: string }[] = [];
  const seenUrls = new Set<string>();
  outer: for (const block of textBlocks) {
    for (const citation of block.citations ?? []) {
      if (citation.type !== "web_search_result_location" || !citation.url) continue;
      if (seenUrls.has(citation.url)) continue;
      seenUrls.add(citation.url);
      sources.push({ title: citation.title ?? citation.url, url: citation.url });
      if (sources.length >= 3) break outer;
    }
  }

  if (!summary) {
    throw new ClassificationError("Claude's research pass returned no summary text");
  }
  return { summary, sources };
}

async function callResearchWithRetry(correctionText: string, original: ClassificationResult) {
  try {
    return await callResearch(correctionText, original);
  } catch (err) {
    console.warn("[claudeClient] correction research call failed, retrying once:", err);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await callResearch(correctionText, original);
  }
}

async function callCorrectionStructuring(
  researchSummary: string,
  correctionText: string,
  original: ClassificationResult
): Promise<RawClassification> {
  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    tools: [classifyTool],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL_NAME },
    messages: [
      {
        role: "user",
        content:
          `A user corrected an earlier (likely wrong) classification of "${describeOriginalForCorrection(original)}" ` +
          `by saying: "${correctionText}". That correction was researched on the web; here is what the research ` +
          `found: ${researchSummary} Based on the user's correction and this research, call report_classification ` +
          `with the corrected, verified classification. ` +
          CLASSIFICATION_PROMPT,
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === CLASSIFY_TOOL_NAME
  );
  if (!toolUse) {
    throw new ClassificationError("Claude did not return a structured classification for the correction");
  }
  return toolUse.input as RawClassification;
}

async function callCorrectionStructuringWithRetry(
  researchSummary: string,
  correctionText: string,
  original: ClassificationResult
): Promise<RawClassification> {
  try {
    return await callCorrectionStructuring(researchSummary, correctionText, original);
  } catch (err) {
    console.warn("[claudeClient] correction structuring call failed, retrying once:", err);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await callCorrectionStructuring(researchSummary, correctionText, original);
  }
}

/**
 * Verifies a user's free-text correction against a real web search, then
 * structures the verified result into a full ClassificationResult. Two Anthropic
 * calls (see the block comment above this section for why it can't be one) — the
 * three ways this can come up short (rate-limited, research failed, structuring
 * failed) are surfaced distinctly rather than silently degrading, unlike
 * classifyImage's Vision/Gemini ensemble signals: a failed search here isn't a
 * droppable secondary opinion, it's the entire point of the endpoint, so the
 * route needs a real error to show the user instead of a quiet fallback.
 *
 * brandGuess/brandConfidence are trusted directly from the structuring call's own
 * output here, unlike classifyFromBarcode's forced override. classifyFromBarcode
 * can override because a UPC's `brand` field is one authoritative ground-truth
 * source with nothing to weigh it against. Here there's no equivalent single
 * authoritative field — the user's text is an assertion, and the web research is
 * itself Claude's synthesized judgment, not a structured record — so forcing
 * "high" confidence would overstate certainty the pipeline doesn't actually have.
 */
export async function verifyCorrection(correctionText: string, original: ClassificationResult): Promise<CorrectionResult> {
  if (!canMakeWebSearchCall()) {
    return { status: "rate_limited" };
  }

  let research: { summary: string; sources: { title: string; url: string }[] };
  try {
    research = await callResearchWithRetry(correctionText, original);
  } catch (err) {
    console.error("[claudeClient] correction research failed:", err);
    return { status: "research_unavailable" };
  }

  let raw: RawClassification;
  try {
    raw = await callCorrectionStructuringWithRetry(research.summary, correctionText, original);
  } catch (err) {
    console.error("[claudeClient] correction structuring failed:", err);
    const reason = err instanceof ClassificationError ? err.message : "Unknown error structuring the corrected classification";
    return { status: "structuring_failed", reason };
  }

  return {
    status: "ok",
    classification: {
      ...raw,
      model: "claude-haiku-4-5",
      source: "correction",
      sources: research.sources.length > 0 ? research.sources : undefined,
    },
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
