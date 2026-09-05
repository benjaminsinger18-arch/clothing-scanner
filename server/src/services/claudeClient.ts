// Wraps the Claude Messages API for garment classification. Uses tool-forced
// structured output (rather than parsing free text) so the response always
// matches ClassificationResult's shape.

import Anthropic from "@anthropic-ai/sdk";
import { type BrandConfidence, type ClassificationResult, type Gender } from "@clothing-scanner/shared-types";
import type { SupportedMediaType } from "../lib/imageUtils.js";
import {
  CLASSIFICATION_JSON_SCHEMA,
  CLASSIFICATION_PROMPT,
  MULTI_ITEM_JSON_SCHEMA,
  MULTI_ITEM_PROMPT,
  MULTI_ITEM_TOOL_NAME,
  type RawClassification,
  type RawMultiItemClassification,
} from "../lib/classificationSchema.js";
import { getVisionSignal, type VisionSignal } from "./visionClient.js";
import { classifyMultiItemWithGemini } from "./geminiClient.js";
import { getFashionClipCategoryHint } from "./fashionClipClient.js";
import type { UpcItem } from "./upcClient.js";
import { canMakeWebSearchCall, recordWebSearchCall } from "../lib/rateLimitTracker.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-5";
const GEMINI_MODEL_LABEL = "gemini-3.1-pro";
const CLASSIFY_TOOL_NAME = "report_classification";
const OUTFIT_TOOL_NAME = "report_outfit_suggestions";

// Diagnostic-only, not a metrics pipeline — gated so a production deploy's logs
// stay quiet by default. Logs call-duration timing (see classifyImage) so a
// slow scan can be attributed to a specific stage instead of guessed at.
const LOG_TIMING = process.env.NODE_ENV !== "production";

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

// Prompt caching (cache_control on this tool + outfitTool below) was tried and
// dropped: live-verified via logCacheUsage below that cache_creation_input_tokens
// stayed 0 across repeated calls, meaning this schema (~200-300 tokens) never
// clears Anthropic's minimum cacheable block size (2048 tokens for Haiku, which
// classifyFromBarcode/verifyCorrection/suggestOutfitPairings all use; 1024 for
// Sonnet, which classifyImage uses — still comfortably above this schema's
// size). Caching only the image-adjacent message content wouldn't help either,
// since the image differs every request and caching is prefix-based. Not worth
// re-attempting unless this schema grows substantially.
const classifyTool: Anthropic.Tool = {
  name: CLASSIFY_TOOL_NAME,
  description: "Report the structured classification of a piece of clothing shown in a photo.",
  // Shared with geminiClient.ts's response_format.schema — see classificationSchema.ts
  // for why (keeps both providers' outputs directly comparable/mergeable).
  input_schema: CLASSIFICATION_JSON_SCHEMA as unknown as Anthropic.Tool["input_schema"],
};

// Separate tool for the main photo-scan path only (classifyImage below) — every
// other call site in this file (classifyFromBarcode, verifyCorrection's
// structuring call) keeps using classifyTool/CLASSIFICATION_JSON_SCHEMA above
// completely untouched, since those are always genuinely one item, never several.
const multiItemTool: Anthropic.Tool = {
  name: MULTI_ITEM_TOOL_NAME,
  description: "Report every distinct wearable clothing item visible in a photo, excluding belts and jewelry.",
  input_schema: MULTI_ITEM_JSON_SCHEMA as unknown as Anthropic.Tool["input_schema"],
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

/** Multi-item counterpart to callClaude — same shape, forces multiItemTool instead
 * of classifyTool, returns the whole items array rather than one object. Only
 * used by classifyImage's photo-scan path. */
async function callClaudeMultiItem(model: string, opts: ClassifyOptions): Promise<RawClassification[]> {
  const hintText = opts.hint
    ? ` A separate image-recognition system's best guess for this photo is "${opts.hint}" — treat that ` +
      "as a hint, not ground truth: weigh it against what you actually see, and still return an empty " +
      "items array if the hint doesn't hold up either."
    : "";

  const response = await getClient().messages.create({
    model,
    max_tokens: 1536, // several items' worth of structured output, vs. classifyTool's single-item 512
    tools: [multiItemTool],
    tool_choice: { type: "tool", name: MULTI_ITEM_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: opts.mediaType, data: opts.imageBase64 } },
          {
            type: "text",
            text:
              "Identify every distinct wearable clothing item in this photo and call " +
              "report_clothing_items with your best assessment. " +
              MULTI_ITEM_PROMPT +
              hintText,
          },
        ],
      },
    ],
  });
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === MULTI_ITEM_TOOL_NAME
  );
  if (!toolUse) {
    throw new ClassificationError("Claude did not return a structured multi-item classification");
  }
  return (toolUse.input as RawMultiItemClassification).items;
}

async function callClaudeMultiItemWithRetry(model: string, opts: ClassifyOptions): Promise<RawClassification[]> {
  try {
    return await callClaudeMultiItem(model, opts);
  } catch (err) {
    console.warn(`[claudeClient] ${model} multi-item call failed, retrying once:`, err);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await callClaudeMultiItem(model, opts);
  }
}

/** Post-hoc merge of Vision's logo detection into a result. Only fills in/upgrades
 * the brand guess when the result itself was unconfident (none/low) — a confident
 * guess (medium/high) is left untouched, since it's already vetted against the
 * actual image context and Vision's logo match hasn't been. Forces brandConfidence
 * to "low" regardless of Vision's own score, and tags brandSource so this is never
 * conflated with the model's own guess.
 *
 * Gemini used to also feed into this (a second cross-validation source, ranked
 * above Vision's raw logo match), back when it ran on every scan. It doesn't
 * anymore — see classifyImage's doc comment for why — so Gemini's own brand
 * judgment now only ever surfaces via its own rescue result directly (untouched,
 * since it's primary there, not a secondary opinion to cross-validate). */
function applyVisionBrandSignal(
  primary: RawClassification,
  vision: VisionSignal | null
): RawClassification & { brandSource?: "vision-logo" } {
  if (primary.brandConfidence !== "none" && primary.brandConfidence !== "low") return primary;

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
 * common (recognized) path below, same as before.
 *
 * Google Cloud Vision runs as an always-on ensemble signal alongside that one
 * Claude call — fired concurrently, so it never delays Claude's first call, and
 * (being a lightweight annotate call, not a reasoning model) awaiting it after
 * Claude resolves is expected to add ~zero latency to the common path.
 *
 * Gemini is deliberately NOT part of that always-on signal — it used to be
 * (fired concurrently on every scan, for brand cross-validation), but that traded
 * real, unpredictable latency for a marginal benefit on the common case: measured
 * live, classify averaged ~2.2-2.6s without Gemini in the mix vs. 3-7.7s with it,
 * since Gemini 3.1 Pro spends real time "thinking" internally even at its lowest
 * setting, unlike Vision's cheap annotate call. That cost is only worth paying
 * when Claude has genuinely failed to identify the item at all — Gemini is called
 * *only* on that rescue path below, same as Vision's hint-rescue always was, not
 * on every scan.
 *
 * The rescue order when Claude comes back unrecognized:
 *   1. Gemini's own independent pass — a full second opinion, stronger recovery
 *      than a hint, since it's Gemini's own reasoned classification rather than
 *      Claude reconsidering with a fragment of context.
 *   2. Vision-hint rescue (last resort) — only tried if Gemini also couldn't
 *      identify it (or isn't configured): Vision's web/label best guess seeds a
 *      hint for one retry Claude call.
 * Both degrade silently and independently if unconfigured/erroring — with
 * neither available, this is exactly Claude-alone behavior.
 */

/** Maps a batch of raw per-item results into ClassificationResults, tagging every
 * item with the same model/extra-flags — used at every return point below so the
 * "which provider/rescue stage produced this" tagging can't drift between items
 * from the same pass. */
function toResults(
  items: RawClassification[],
  model: ClassificationResult["model"],
  extra?: Partial<ClassificationResult>
): ClassificationResult[] {
  return items.map((raw) => ({ ...raw, model, ...extra }));
}

export async function classifyImage(opts: ClassifyOptions): Promise<ClassificationResult[]> {
  // Vision starts immediately, in parallel — cheap enough to always run. Gemini
  // does NOT start here anymore (see the latency note above) — it's only called
  // further down, and only on the empty-result path.
  const visionStartedAt = Date.now();
  const visionPromise = getVisionSignal(opts.imageBase64).catch(() => null);
  if (LOG_TIMING) {
    visionPromise.then(() => console.log(`[claudeClient] Vision: ${Date.now() - visionStartedAt}ms`));
  }

  const claudeStartedAt = Date.now();
  const first = await callClaudeMultiItemWithRetry(SONNET_MODEL, opts);
  if (LOG_TIMING) {
    console.log(`[claudeClient] Sonnet (first pass): ${Date.now() - claudeStartedAt}ms, ${first.length} item(s)`);
  }

  if (first.length > 0) {
    // Common path: Claude already has an answer. Await the concurrently-started
    // Vision promise — typically already resolved, so this is expected to be
    // near-instant. No Gemini call on this path at all. Vision's logo detection is
    // whole-photo and ambiguous about which garment it belongs to in a multi-item
    // shot, so its brand-fill only ever applies to the primary (first-listed) item
    // — attributing one detected logo to every item risks misattributing it to
    // garments it doesn't belong to.
    const vision = await visionPromise;
    const [primary, ...rest] = first;
    const mergedPrimary = applyVisionBrandSignal(primary, vision);
    return toResults([mergedPrimary, ...rest], "claude-sonnet-5");
  }

  // Claude found nothing at all — NOW call Gemini, only here, so its latency is
  // paid rarely (a genuine failure) rather than on every scan. Try Gemini's own
  // independent answer first — a full second opinion beats a single-phrase hint
  // fed back to Claude.
  const gemini = await classifyMultiItemWithGemini(opts.imageBase64, opts.mediaType).catch(() => null);
  if (gemini && gemini.length > 0) {
    const vision = await visionPromise;
    const [primary, ...rest] = gemini;
    const mergedPrimary = applyVisionBrandSignal(primary, vision);
    return toResults([mergedPrimary, ...rest], GEMINI_MODEL_LABEL);
  }

  // Gemini also found nothing (or isn't configured) — fall back to the existing
  // Vision-hint rescue as a last resort. Reuses the same already-in-flight Vision
  // promise (it had a head start from launching concurrently).
  const vision = await visionPromise;
  if (!vision) {
    return [];
  }

  // Prefer Vision's general scene guess for the rescue hint; if web/label detection
  // came up empty but a logo was found, fall back to a logo-derived hint.
  const hintText = vision.bestGuess ?? (vision.logos[0] ? `a logo matching "${vision.logos[0].description}"` : null);
  if (!hintText) {
    return [];
  }

  const retried = await callClaudeMultiItemWithRetry(SONNET_MODEL, { ...opts, hint: hintText });
  if (retried.length > 0) {
    const [primary, ...rest] = retried;
    const mergedPrimary = applyVisionBrandSignal(primary, vision);
    return toResults([mergedPrimary, ...rest], "claude-sonnet-5", { visionAssisted: true });
  }

  // Claude, Gemini, AND the Vision-hint retry have all now failed — genuinely rare
  // (three misses deep), so one more attempt here costs nothing on the common path.
  // Fashion-CLIP is a differently-trained model asked a much narrower question
  // (one whole-photo category signal, see fashionClipClient.ts) — it can only ever
  // suggest "this category probably shows up somewhere in the photo," not enumerate
  // multiple items, so it's used purely as one more hint, not a replacement for
  // multi-item detection. FASHION_CLIP_MIN_SCORE requires it to clearly stand out
  // from the ~0.125 baseline an 8-way random guess would score, so a genuinely
  // uncertain Fashion-CLIP result doesn't push Claude toward a confident-but-wrong
  // answer.
  const fashionClip = await getFashionClipCategoryHint(opts.imageBase64);
  if (!fashionClip || fashionClip.score < FASHION_CLIP_MIN_SCORE) {
    return [];
  }

  const finalRetry = await callClaudeMultiItemWithRetry(SONNET_MODEL, {
    ...opts,
    hint: `${fashionClip.phrase} (per a separate fashion-focused image classifier — this only signals one likely category among possibly several items in the photo, not the complete list)`,
  });
  if (finalRetry.length === 0) {
    return [];
  }
  const [primary, ...rest] = finalRetry;
  const mergedPrimary = applyVisionBrandSignal(primary, vision);
  return toResults([mergedPrimary, ...rest], "claude-sonnet-5", { fashionClipAssisted: true });
}

// An 8-way zero-shot guess scores ~0.125 on average if genuinely uncertain between
// candidates — require clearly better than that before feeding it to Claude as a
// hint, so a coin-flip Fashion-CLIP result doesn't nudge an honest "unrecognized"
// into a confident-but-wrong guess.
const FASHION_CLIP_MIN_SCORE = 0.35;

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
                'Short, search-friendly keyword phrase for the complementary item, e.g. "men\'s navy chino ' +
                'pants" or "women\'s white leather sneakers" — not a full sentence, and not a restatement ' +
                "of the item itself. Include the gender in the phrase itself (as shown) whenever the item " +
                "being paired with is gendered, so the downstream product search comes back correctly " +
                'gendered — omit it only when suggesting a genuinely unisex item (e.g. "canvas tote bag").',
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
  gender: Gender;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}

function describeItem(input: OutfitPairingInput): string {
  const brandPart =
    input.brandGuess && (input.brandConfidence === "medium" || input.brandConfidence === "high")
      ? ` (possibly ${input.brandGuess})`
      : "";
  const patternPart = input.pattern && input.pattern.toLowerCase() !== "none" ? `${input.pattern} ` : "";
  return `${input.color} ${patternPart}${input.garmentType}${brandPart}, style: ${input.style}, category: ${input.category}, styled for: ${input.gender}`;
}

async function callOutfitSuggestions(input: OutfitPairingInput): Promise<string[]> {
  const genderInstruction =
    input.gender === "unisex"
      ? "This item is unisex/gender-neutral — suggest gender-neutral pairings, or lean toward whichever " +
        "gendering reads most natural for the specific pairing item if a truly neutral option doesn't exist."
      : `This item is styled for ${input.gender} — every suggested pairing item must match that (${input.gender}'s ` +
        "cut/style), not a mix, since these are meant to complete one coherent outfit for one wearer.";

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
          `${genderInstruction} ` +
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
