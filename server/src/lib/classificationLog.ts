// Append-only local log of every classification the backend produces (photo
// scans + barcode lookups) — independent of correctionLog.ts's per-correction
// log. Corrections.jsonl is a *biased* sample (only scans someone bothered to
// correct); this captures every scan's outcome, so you can measure real usage
// patterns from an unbiased base rate: what fraction of scans come back
// "unrecognized", how often Gemini's rescue pass or Vision's brand-fill signal
// actually fires, the brandConfidence distribution, etc.
//
// Deliberately does NOT store the photo or a thumbnail — scan volume is much
// higher than deliberate corrections, so keeping this image-free bounds growth
// to one small JSON line per scan instead of an ever-growing image archive. If
// you need the image for a specific failure, that's what the Correction flow +
// corrections.jsonl already cover (see correctionLog.ts).
//
// Same known limitation as correctionLog.ts: no persistent disk on Render's
// free tier by default — this survives local dev restarts but is wiped on
// every Render restart/redeploy, UNLESS bucket sync is configured (see
// bucketSync.ts), in which case this file is restored from a Hugging Face
// Storage Bucket at startup and re-synced there after every write.

import { mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClassificationResult } from "@clothing-scanner/shared-types";
import { syncToBucket } from "./bucketSync.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src/lib -> server/data (same directory correctionLog.ts writes into)
const LOG_DIR = join(__dirname, "..", "..", "data");
export const LOG_FILE = join(LOG_DIR, "classifications.jsonl");

export interface ClassificationLogEntry {
  timestamp: string; // ISO 8601
  /** Which endpoint produced this classification. Correction-flow results are
   * intentionally excluded — those already get their own, richer entry in
   * corrections.jsonl (original guess + correction text + verified result). */
  trigger: "classify" | "barcode-lookup";
  /** "classify" logs the full per-scan array (possibly empty — see classifyImage
   * in claudeClient.ts) since one photo can now report several items; "barcode-lookup"
   * still logs a single result, a barcode match always being exactly one product. */
  result: ClassificationResult | ClassificationResult[];
}

/** Appends one JSON line. Synchronous for the same reason as correctionLog.ts's
 * logCorrection — cheap for a single short line, and avoids concurrent
 * requests' writes ever interleaving mid-line. Callers should wrap this in
 * try/catch: a logging failure must never affect the user-facing response. */
export function logClassification(entry: ClassificationLogEntry): void {
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
  syncToBucket(LOG_FILE, "classifications.jsonl");
}
