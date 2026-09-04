// Append-only local log of user-submitted corrections, for later review/curation
// into the eval golden set (see server/eval/) and for spotting systematic
// classification failures. Deliberately NOT a database — a JSONL file is the
// simplest thing that persists across restarts (unlike rateLimitTracker.ts's
// in-memory counters, which reset on restart by design — that's fine for quota
// counters but wrong for data worth keeping).
//
// KNOWN LIMITATION: on Render's free tier there is no persistent disk by default
// — this file (and the server/data/ directory it lives in) is wiped on every
// restart/redeploy there. Reliable today only for local dev. If corrections need
// to survive on the deployed instance, that requires a Render persistent disk
// (paid) or an external store (S3, a hosted DB, etc.) — out of scope here.

import { mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClassificationResult } from "@clothing-scanner/shared-types";

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src/lib -> server/data
const LOG_DIR = join(__dirname, "..", "..", "data");
const LOG_FILE = join(LOG_DIR, "corrections.jsonl");

export interface CorrectionLogEntry {
  timestamp: string; // ISO 8601
  original: ClassificationResult;
  correctionText: string;
  corrected: ClassificationResult;
  photoThumbnail?: string;
}

/** Appends one JSON line. Synchronous on purpose — for a single short line this
 * costs nothing measurable, and it avoids two concurrent corrections' writes
 * ever interleaving mid-line (a real risk with fs.promises.appendFile under
 * concurrent writers). Correction submissions are a deliberate user action, not
 * scan volume, so throughput here is inherently low. Callers should wrap this in
 * try/catch — a logging failure must never affect the user-facing response. */
export function logCorrection(entry: CorrectionLogEntry): void {
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
}
