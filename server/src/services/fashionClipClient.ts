// Fashion-CLIP (https://huggingface.co/patrickjohncyh/fashion-clip, MIT licensed) via
// Hugging Face's hosted Inference API — a zero-shot image classifier fine-tuned on
// ~800k fashion product image/text pairs. Unlike Claude/Gemini, it doesn't freely
// describe an image; it scores a *fixed list of candidate labels* against the image
// and returns how well each one matches. That maps well onto `category` (a genuine
// closed enum, see classificationSchema.ts) and poorly onto free-text fields like
// garmentType/color/style, so this client only ever asks about category.
//
// Deliberately NOT wired in as an always-on ensemble signal like Vision. Claude
// Sonnet is already strong at coarse 8-way category judgments on anything it
// actually recognizes — the plausible win here is narrow: cases where Claude's
// first pass *and* the Gemini rescue *and* the Vision-hint retry have all already
// come back "unrecognized" (see classifyImage in claudeClient.ts). That's the one
// place a cheap, differently-trained opinion has a real chance of unsticking an
// otherwise-total failure, and it's rare enough that the extra latency/cost here
// never touches the common path — same reasoning that keeps Gemini rescue-only
// rather than always-on (see that revert, documented in README.md).

import { canMakeFashionClipCall, recordFashionClipCall } from "../lib/rateLimitTracker.js";
import { CLASSIFICATION_JSON_SCHEMA } from "../lib/classificationSchema.js";

const MODEL_URL = "https://api-inference.huggingface.co/models/patrickjohncyh/fashion-clip";
const REQUEST_TIMEOUT_MS = 10000; // generous vs. Vision's 4s — only hit on a rare last-resort path, and HF's free tier can have cold-start latency

export class FashionClipApiError extends Error {}

// CLIP-style models score much better against natural-language template phrases
// than bare enum words (e.g. "a photo of a top" beats "tops") — this is the whole
// reason candidate labels are hand-written here rather than passing the raw enum.
// `phrase` doubles as both half of the label sent to Fashion-CLIP ("a photo of
// " + phrase) and, on a match, the hint text fed back into Claude's retry prompt
// (see claudeClient.ts) — kept as one short noun phrase so it reads naturally in
// both places rather than maintaining two separate wordings.
const CATEGORY_CANDIDATES: { phrase: string; category: string }[] = [
  { phrase: "a top, shirt, or blouse", category: "tops" },
  { phrase: "pants, jeans, or shorts", category: "bottoms" },
  { phrase: "a jacket or coat", category: "outerwear" },
  { phrase: "a dress", category: "dresses" },
  { phrase: "shoes or footwear", category: "footwear" },
  { phrase: "a fashion accessory like a bag, hat, or belt", category: "accessories" },
  { phrase: "athletic or activewear clothing", category: "activewear" },
  { phrase: "underwear, loungewear, or sleepwear", category: "underwear-sleepwear" },
];

// Sanity check, at module load, that every category this file can return is one
// classificationSchema.ts actually accepts — if that enum ever changes, this
// throws immediately on startup instead of silently returning a category value
// the rest of the app doesn't recognize.
const VALID_CATEGORIES: readonly string[] = CLASSIFICATION_JSON_SCHEMA.properties.category.enum;
for (const c of CATEGORY_CANDIDATES) {
  if (!VALID_CATEGORIES.includes(c.category)) {
    throw new Error(`[fashionClipClient] "${c.category}" is not in classificationSchema.ts's category enum`);
  }
}

interface HfZeroShotResult {
  label: string;
  score: number;
}

export interface FashionClipSignal {
  category: string;
  /** The short noun phrase that won (e.g. "a jacket or coat") — reused as the hint
   * text for Claude's rescue retry, see classifyImage in claudeClient.ts. */
  phrase: string;
  score: number;
}

/**
 * Asks Fashion-CLIP which category candidate best matches the photo. Returns null
 * if unconfigured, rate-limited, the model is cold-starting (HF's free tier unloads
 * idle models — we don't make a user-facing request wait out a ~20s cold start),
 * or any other error. Callers should treat null as "no signal, proceed without it,"
 * exactly like getVisionSignal.
 */
export async function getFashionClipCategoryHint(imageBase64: string): Promise<FashionClipSignal | null> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!canMakeFashionClipCall()) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(MODEL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: imageBase64,
        parameters: { candidate_labels: CATEGORY_CANDIDATES.map((c) => `a photo of ${c.phrase}`) },
      }),
      signal: controller.signal,
    });
    recordFashionClipCall();

    if (response.status === 503) {
      // Model is loading (cold start) — HF returns { error, estimated_time } here.
      // Worth logging (helps notice if this is firing often enough to matter) but
      // not worth retrying inline; give up for this scan like any other miss.
      console.warn("[fashionClipClient] model is cold-starting, skipping this scan:", await response.text());
      return null;
    }
    if (!response.ok) {
      throw new FashionClipApiError(`Fashion-CLIP request failed: ${response.status} ${await response.text()}`);
    }

    const results = (await response.json()) as HfZeroShotResult[];
    const top = [...results].sort((a, b) => b.score - a.score)[0];
    if (!top) {
      return null;
    }
    const matched = CATEGORY_CANDIDATES.find((c) => `a photo of ${c.phrase}` === top.label);
    if (!matched) {
      // Shouldn't happen (HF only ever returns labels we sent it) — fail safe rather
      // than propagate an unrecognized category value.
      return null;
    }
    return { category: matched.category, phrase: matched.phrase, score: top.score };
  } catch (err) {
    console.error("[fashionClipClient] classification failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
