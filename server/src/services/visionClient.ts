// Google Cloud Vision integration — a fallback identification pass for when Claude's
// vision call can't confidently name the item at all. Vision's web/label detection
// matches the photo against Google's image index, which sometimes recognizes a
// specific product, logo, or garment type that a general-purpose vision model misses
// (unusual angle, niche item, heavy background clutter). It doesn't replace Claude's
// structured classification (no color/pattern/style judgment) — it just supplies a
// text hint for a second Claude pass to work with.
// Docs: https://cloud.google.com/vision/docs/detecting-web
//
// Takes image bytes directly (base64), unlike SerpApi's Google Lens engine, which
// requires a publicly hosted image URL — a good fit here since photos never leave
// the request as anything but base64.

import { canMakeVisionCall, recordVisionCall } from "../lib/rateLimitTracker.js";

const ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate";

export class VisionApiError extends Error {}

interface WebDetection {
  bestGuessLabels?: { label: string }[];
  webEntities?: { description?: string; score?: number }[];
}

interface LabelAnnotation {
  description: string;
  score: number;
}

interface AnnotateResponse {
  responses?: {
    webDetection?: WebDetection;
    labelAnnotations?: LabelAnnotation[];
    error?: { message: string };
  }[];
}

/**
 * Asks Google Cloud Vision what it thinks the photo shows, and returns a single
 * best-effort text hint (e.g. "Levi's trucker jacket", "leather chelsea boots") for
 * Claude to reconsider its classification with. Returns null if unconfigured,
 * rate-limited, errored, or Vision genuinely found nothing useful — callers should
 * treat null the same as "no fallback available" and keep the original result.
 */
export async function identifyWithVision(imageBase64: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!canMakeVisionCall()) {
    return null;
  }

  const url = new URL(ANNOTATE_URL);
  url.searchParams.set("key", apiKey);

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
            ],
          },
        ],
      }),
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
    const bestGuess = result.webDetection?.bestGuessLabels?.[0]?.label;
    if (bestGuess) return bestGuess;

    const topEntity = [...(result.webDetection?.webEntities ?? [])]
      .filter((e) => e.description)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (topEntity?.description) return topEntity.description;

    const topLabel = [...(result.labelAnnotations ?? [])].sort((a, b) => b.score - a.score)[0];
    return topLabel?.description ?? null;
  } catch (err) {
    console.error("[visionClient] identification failed:", err);
    return null;
  }
}
