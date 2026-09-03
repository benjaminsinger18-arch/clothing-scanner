// Gemini integration — a second, independent full classification opinion that runs
// in parallel with Claude's (see claudeClient.ts's classifyImage), not a fallback.
// Two jobs:
//   1. Brand cross-validation — when Claude's own brand guess is unconfident, a
//      confident Gemini guess can fill it in (softened a notch, clearly attributed —
//      see applyBrandCrossValidation in claudeClient.ts).
//   2. Unrecognized-item rescue — if Claude can't name the item at all, and Gemini
//      *can*, Gemini's own full classification is used directly (stronger recovery
//      than Vision's single-phrase hint, since it's a full reasoned opinion, not
//      just an entity match).
// Uses the same CLASSIFICATION_JSON_SCHEMA as Claude's tool so both providers'
// outputs are directly comparable.
//
// Cost note: unlike every other optional provider in this codebase, Gemini 3.1 Pro
// has no free tier at all — it's billed from the first call (~$2/M input,
// ~$12/M output tokens as of writing). At this project's usage scale (~80-100
// scans/month) that's rough pennies overall, but flagging it since every other
// cap here exists to protect a free allotment; this one is a pure runaway-cost
// circuit breaker instead.

import { GoogleGenAI } from "@google/genai";
import type { SupportedMediaType } from "../lib/imageUtils.js";
import { CLASSIFICATION_JSON_SCHEMA, CLASSIFICATION_PROMPT, type RawClassification } from "../lib/classificationSchema.js";
import { canMakeGeminiCall, recordGeminiCall } from "../lib/rateLimitTracker.js";

const GEMINI_MODEL = "gemini-3.1-pro-preview";
// Gemini 3.1 Pro defaults to "high" thinking (measured ~4s even on a trivial
// text-only "say hello" prompt, all of it spent on internal reasoning tokens
// before any output) — "low" is the lowest level this model accepts ("minimal"
// exists for other models but this one rejects it). Still real latency on top of
// that floor for an actual image+schema task, hence the generous timeout below.
const THINKING_LEVEL = "low";
const REQUEST_TIMEOUT_MS = 15000;

export class GeminiClassificationError extends Error {}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new GeminiClassificationError(
        "GEMINI_API_KEY is not set — copy server/.env.example to server/.env and fill it in"
      );
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new GeminiClassificationError(`Gemini call timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Asks Gemini for its own full structured classification of the same photo Claude
 * is looking at. Returns null if unconfigured, rate-limited, timed out, errored, or
 * the response didn't parse — callers should treat null as "no second opinion
 * available" and proceed on Claude (+ Vision) alone. A non-null result may still
 * have garmentType === UNRECOGNIZED_GARMENT (Gemini's honest "couldn't identify
 * it" answer, same sentinel Claude uses) — that's a real answer, not a failure, and
 * callers should treat it as "Gemini agrees there's nothing to see here" rather
 * than degrade as if Gemini were unavailable.
 */
export async function classifyWithGemini(
  imageBase64: string,
  mediaType: SupportedMediaType
): Promise<RawClassification | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!canMakeGeminiCall()) {
    return null;
  }

  try {
    const interaction = await withTimeout(
      getClient().interactions.create({
        model: GEMINI_MODEL,
        input: [
          {
            type: "text",
            text: "Identify the piece of clothing in this photo and report your best assessment. " + CLASSIFICATION_PROMPT,
          },
          { type: "image", data: imageBase64, mime_type: mediaType },
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: CLASSIFICATION_JSON_SCHEMA,
        },
        generation_config: { thinking_level: THINKING_LEVEL },
      }),
      REQUEST_TIMEOUT_MS
    );
    recordGeminiCall();

    if (!interaction.output_text) {
      throw new GeminiClassificationError("Gemini returned no output_text");
    }
    const parsed = JSON.parse(interaction.output_text) as RawClassification;
    if (!parsed.garmentType || !parsed.category) {
      throw new GeminiClassificationError("Gemini's structured output was missing required fields");
    }
    return parsed;
  } catch (err) {
    console.error("[geminiClient] classification failed:", err);
    return null;
  }
}
