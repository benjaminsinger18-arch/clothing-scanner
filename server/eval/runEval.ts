// Classification accuracy eval harness — run via `npm run eval --workspace=server`.
//
// COST NOTE: every run makes real Claude Sonnet 5 calls (plus Vision/Gemini if
// those keys are configured in server/.env) for every entry in golden/labels.json
// — there is no mocking here, since the whole point is measuring real model
// behavior, not a code-correctness test. Keep the golden set to roughly 15-30
// photos (see golden/README.md) to keep a run cheap and fast.
//
// This is a report, not a CI gate — it always exits 0. There's no CI in this repo
// yet, and no test framework asserts on these results; promoting this into a
// pass-rate-blocking check is a future decision, not part of this script's job.
//
// Deliberately lives outside server/src (server/tsconfig.json's rootDir/include
// are both scoped to "src") so this stays out of `npm run build`/`typecheck` —
// it's a dev-only measurement tool, never part of the deployed server.

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrandConfidence, ClassificationResult } from "@clothing-scanner/shared-types";
import { classifyImage, ClassificationError } from "../src/services/claudeClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, "golden");
const IMAGES_DIR = join(GOLDEN_DIR, "images");
const LABELS_FILE = join(GOLDEN_DIR, "labels.json");

// Small delay between calls — keeps well under rate limits and keeps console
// output readable, rather than firing every request in parallel.
const DELAY_BETWEEN_CALLS_MS = 500;

// Fields graded exact-match (both are enums on ClassificationResult).
const ENUM_FIELDS = ["category", "gender"] as const;
// Fields graded case-insensitive substring-either-direction (free text — exact
// match would be too strict, e.g. expected "t-shirt" vs actual "cotton t-shirt").
const FREE_TEXT_FIELDS = ["garmentType", "color", "pattern", "style"] as const;
const ALL_GRADED_FIELDS = [...ENUM_FIELDS, ...FREE_TEXT_FIELDS, "brandGuess"] as const;

type GradedField = (typeof ALL_GRADED_FIELDS)[number];

interface GoldenEntry {
  filename: string;
  expected: Partial<
    Pick<ClassificationResult, "garmentType" | "category" | "color" | "pattern" | "style" | "gender" | "brandGuess">
  >;
}

type FieldResult = "pass" | "fail";

/** Pure so it's independently readable/testable. Only called for fields present
 * in `expected` — an omitted field (e.g. `style` left out because it's too
 * subjective) is simply never graded for that item, not auto-passed/failed. */
function compareField(field: GradedField, expected: unknown, actual: unknown): FieldResult {
  if (field === "brandGuess") {
    if (expected === null && actual === null) return "pass";
    if (expected === null || actual === null) return "fail";
    return substringMatch(String(expected), String(actual));
  }
  if ((ENUM_FIELDS as readonly string[]).includes(field)) {
    return expected === actual ? "pass" : "fail";
  }
  // Free-text field.
  return substringMatch(String(expected), String(actual));
}

function substringMatch(expected: string, actual: string): FieldResult {
  const e = expected.toLowerCase();
  const a = actual.toLowerCase();
  return e.includes(a) || a.includes(e) ? "pass" : "fail";
}

function inferMediaType(filename: string): "image/jpeg" | "image/png" | "image/webp" {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg"; // default, matches the app's own compression output
}

interface ItemReport {
  entry: GoldenEntry;
  error?: string;
  failures: { field: GradedField; expected: unknown; actual: unknown }[];
  brandConfidenceNote: { expectedBrandPresent: boolean; actualConfidence: BrandConfidence } | null;
}

async function runOne(entry: GoldenEntry): Promise<ItemReport> {
  const report: ItemReport = { entry, failures: [], brandConfidenceNote: null };

  let imageBase64: string;
  try {
    imageBase64 = readFileSync(join(IMAGES_DIR, entry.filename)).toString("base64");
  } catch (err) {
    report.error = `Could not read image: ${err instanceof Error ? err.message : String(err)}`;
    return report;
  }

  let actual: ClassificationResult;
  try {
    actual = await classifyImage({ imageBase64, mediaType: inferMediaType(entry.filename) });
  } catch (err) {
    report.error =
      err instanceof ClassificationError ? err.message : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    return report;
  }

  for (const field of ALL_GRADED_FIELDS) {
    if (!(field in entry.expected)) continue; // not graded for this item
    const expectedValue = entry.expected[field as keyof typeof entry.expected];
    const actualValue = actual[field as keyof ClassificationResult];
    if (compareField(field, expectedValue, actualValue) === "fail") {
      report.failures.push({ field, expected: expectedValue, actual: actualValue });
    }
  }

  // Brand confidence calibration — never pass/fail, just an eyeball signal.
  report.brandConfidenceNote = {
    expectedBrandPresent: entry.expected.brandGuess !== undefined && entry.expected.brandGuess !== null,
    actualConfidence: actual.brandConfidence,
  };

  return report;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printSummary(reports: ItemReport[]): void {
  console.log("\n--- Summary ---");
  const gradable = reports.filter((r) => !r.error);
  for (const field of ALL_GRADED_FIELDS) {
    const relevant = gradable.filter((r) => field in r.entry.expected);
    if (relevant.length === 0) continue;
    const passed = relevant.filter((r) => !r.failures.some((f) => f.field === field)).length;
    console.log(`  ${field}: ${passed}/${relevant.length} (${Math.round((passed / relevant.length) * 100)}%)`);
  }

  console.log("\n--- Brand confidence calibration (not graded pass/fail) ---");
  for (const report of gradable) {
    if (!report.brandConfidenceNote) continue;
    console.log(
      `  [${report.entry.filename}] expected brand present: ${report.brandConfidenceNote.expectedBrandPresent}` +
        ` — actual confidence: ${report.brandConfidenceNote.actualConfidence}`
    );
  }

  const errorCount = reports.length - gradable.length;
  if (errorCount > 0) {
    console.log(`\n${errorCount} item(s) errored (API/read failure, not a content mismatch) — see above.`);
  }
}

async function main() {
  const raw: unknown[] = JSON.parse(readFileSync(LABELS_FILE, "utf8"));
  // Tolerate a stray "_comment" key on any entry (used for in-file
  // documentation) without treating it as a real golden entry.
  const entries = raw.filter((e): e is GoldenEntry => typeof e === "object" && e !== null && "filename" in e);

  if (entries.length === 0) {
    console.log("No golden entries in eval/golden/labels.json yet — see eval/golden/README.md to add some.");
    return;
  }

  console.log(`Running eval against ${entries.length} golden image(s)...\n`);

  const reports: ItemReport[] = [];
  for (const entry of entries) {
    const report = await runOne(entry);
    reports.push(report);

    if (report.error) {
      console.log(`[${entry.filename}] ERROR: ${report.error}`);
    } else if (report.failures.length === 0) {
      console.log(`[${entry.filename}] PASS`);
    } else {
      console.log(`[${entry.filename}] FAIL`);
      for (const f of report.failures) {
        console.log(`  ${f.field}: expected=${JSON.stringify(f.expected)} actual=${JSON.stringify(f.actual)}`);
      }
    }

    await sleep(DELAY_BETWEEN_CALLS_MS);
  }

  printSummary(reports);
}

main().catch((err) => {
  console.error("Eval run failed:", err);
});
