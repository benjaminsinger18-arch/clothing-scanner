// Google Cloud Vision integration — an always-on second opinion that runs in
// parallel with every Claude classification call, not just a fallback for outright
// failures. Serves two purposes (see claudeClient.ts's classifyImage):
//   1. Brand augmentation — LOGO_DETECTION can catch a brand Claude's general vision
//      model was too conservative to name, even on items Claude otherwise identifies
//      fine. Always surfaced as a low-confidence, clearly-attributed guess, never as
//      something validated against the image's actual context.
//   2. Unrecognized-item rescue — when Claude's first pass can't name the item at
//      all, WEB_DETECTION/LABEL_DETECTION's "best guess" seeds a hint for one retry
//      Claude call, same as before — just cheaper now since Vision starts alongside
//      Claude's first call instead of only after it fails.
// It still doesn't replace Claude's structured classification (no color/pattern/
// style judgment) — just supplies signal Claude's own call didn't have.
// Docs: https://cloud.google.com/vision/docs/detecting-web, /docs/detecting-logos
//
// Takes image bytes directly (base64), unlike SerpApi's Google Lens engine, which
// requires a publicly hosted image URL — a good fit here since photos never leave
// the request as anything but base64.

import { canMakeVisionCall, recordVisionCall } from "../lib/rateLimitTracker.js";

const ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate";
const REQUEST_TIMEOUT_MS = 4000;
const LOGO_SCORE_FLOOR = 0.5;

export class VisionApiError extends Error {}

interface WebDetection {
  bestGuessLabels?: { label: string }[];
  webEntities?: { description?: string; score?: number }[];
}

interface LabelAnnotation {
  description: string;
  score: number;
}

interface LogoAnnotation {
  description: string;
  score: number;
}

interface AnnotateResponse {
  responses?: {
    webDetection?: WebDetection;
    labelAnnotations?: LabelAnnotation[];
    logoAnnotations?: LogoAnnotation[];
    error?: { message: string };
  }[];
}

export interface VisionSignal {
  /** General best-guess description from web/label detection — used as the
   * unrecognized-item rescue hint. Same semantics as this module's old return
   * value before it grew logo detection too. */
  bestGuess: string | null;
  /** Logo detections at/above LOGO_SCORE_FLOOR, best-first. Empty if LOGO_DETECTION
   * found nothing usable. */
  logos: { description: string; score: number }[];
}

/**
 * Asks Google Cloud Vision what it thinks the photo shows — a general best-guess
 * description plus any detected logos. Returns null if unconfigured, rate-limited,
 * errored, or Vision genuinely found nothing useful at all; callers should treat
 * null as "no signal available" and fall back to Claude alone. A populated result
 * may still have `bestGuess: null` or `logos: []` individually — only the "both
 * empty" case collapses to null.
 */
export async function getVisionSignal(imageBase64: string): Promise<VisionSignal | null> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!canMakeVisionCall()) {
    return null;
  }

  const url = new URL(ANNOTATE_URL);
  url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBase64 },
            features: [
              { type: "WEB_DETECTION", maxResults: 10 },
              { type: "LABEL_DETECTION", maxResults: 10 },
              { type: "LOGO_DETECTION", maxResults: 5 },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    recordVisionCall();

    if (!response.ok) {
      throw new VisionApiError(`Vision API request failed: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as AnnotateResponse;
    const result = json.responses?.[0];
    if (!result || result.error) {
      throw new VisionApiError(result?.error?.message ?? "Vision API returned no response");
    }

    // Prefer Vision's own "best guess" (it already fuses web + label signals);
    // fall back to the top-scoring web entity, then the top label.
    const bestGuess =
      result.webDetection?.bestGuessLabels?.[0]?.label ??
      [...(result.webDetection?.webEntities ?? [])]
        .filter((e) => e.description)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]?.description ??
      [...(result.labelAnnotations ?? [])].sort((a, b) => b.score - a.score)[0]?.description ??
      null;

    const logos = [...(result.logoAnnotations ?? [])]
      .filter((l) => l.score >= LOGO_SCORE_FLOOR)
      .sort((a, b) => b.score - a.score);

    if (!bestGuess && logos.length === 0) {
      return null;
    }
    return { bestGuess, logos };
  } catch (err) {
    console.error("[visionClient] identification failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
