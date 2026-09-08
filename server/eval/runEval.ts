// Classification accuracy eval harness — run via `npm run eval --workspace=server`.
//
// COST NOTE: every run makes real Claude Sonnet 5 calls (plus Vision/Gemini if
// those keys are configured in server/.env) for every entry in golden/labels.json
// — there is no mocking here, since the whole point is measuring real model
// behavior, not a code-correctness test. The summary this script prints ends with
// a rough dollar estimate (see pricing.ts) so a run's actual cost isn't a guess.
//
// By default this is a report, not a gate — it exits 0 regardless of pass rate.
// Pass --min-pass-rate=<0-100> to turn it into one: exits 1 if the overall pass
// rate (passed field-checks / total graded field-checks, across every entry)
// falls below that threshold. Opt-in rather than a hardcoded gate, since there's
// no established baseline for this set yet and CI (see .github/workflows/ci.yml)
// doesn't run this by default anyway (it costs real API money per run — see the
// cost note above) — wire it into a workflow yourself once you've picked a
// threshold that reflects this set's actual baseline, not a guess.
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
import type { ScanUsage } from "../src/lib/classificationLog.js";
import { CLAUDE_SONNET_PRICE, GEMINI_PRICE, estimateCostUsd, formatUsd } from "./pricing.js";

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
  /** Absent when the run errored before classifyImage returned (e.g. a
   * missing image file never made a paid call at all). */
  usage?: ScanUsage;
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

  // classifyImage can report several detected items per photo (see
  // claudeClient.ts) — the golden set is curated so the labeled garment is
  // always the unambiguous primary subject of the frame (see
  // golden/ATTRIBUTIONS.md's per-batch notes), so grading against
  // classifications[0] matches how these entries were written, same as the
  // rest of the app treating index 0 as "the" item for a single-item context.
  //
  // BUG NOTE: prior to this fix, `actual` was assigned the whole
  // ClassificationResult[] array (classifyImage's real return shape) into a
  // variable typed as a single ClassificationResult — a mismatch `tsc` never
  // caught because eval/ is outside server/tsconfig.json's typechecked
  // "include" (see this file's own top comment on why). At runtime that
  // meant every `actual[field]` lookup below silently read a nonexistent
  // property off an array and got `undefined`, so every eval run since
  // multi-item classification shipped graded 0% on every field, for every
  // entry, silently — nothing surfaced this because the harness has no
  // baseline/regression check of its own (see this file's top comment) and a
  // 0% run reads the same as "the model regressed," not "the harness is
  // broken." Confirmed via a live single-image run before this fix.
  let actual: ClassificationResult;
  try {
    const result = await classifyImage({ imageBase64, mediaType: inferMediaType(entry.filename) });
    // Recorded even on the zero-items early-return below — real tokens were
    // spent on that call regardless of whether it found anything.
    report.usage = result.usage;
    if (result.classifications.length === 0) {
      report.error = "classifyImage returned zero items for this golden photo";
      return report;
    }
    actual = result.classifications[0];
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

/** Returns the overall pass rate as a 0-100 number (micro-averaged: total
 * passed field-checks / total graded field-checks, across every field and
 * every gradable entry — not an average-of-per-field-percentages, which
 * would weight a field graded on 2 entries the same as one graded on all 60),
 * or null if nothing was gradable at all (e.g. every entry errored). Used by
 * main() for the optional --min-pass-rate gate below. */
function printSummary(reports: ItemReport[]): number | null {
  console.log("\n--- Summary ---");
  const gradable = reports.filter((r) => !r.error);
  let totalChecks = 0;
  let totalPassed = 0;
  for (const field of ALL_GRADED_FIELDS) {
    const relevant = gradable.filter((r) => field in r.entry.expected);
    if (relevant.length === 0) continue;
    const passed = relevant.filter((r) => !r.failures.some((f) => f.field === field)).length;
    console.log(`  ${field}: ${passed}/${relevant.length} (${Math.round((passed / relevant.length) * 100)}%)`);
    totalChecks += relevant.length;
    totalPassed += passed;
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

  printCostEstimate(reports);

  return totalChecks === 0 ? null : (totalPassed / totalChecks) * 100;
}

/** Rough total cost estimate for this run — see pricing.ts for the caveat on
 * these numbers. Sums every entry's usage (including zero-item/error entries
 * that still made a billed call) rather than only gradable ones. */
function printCostEstimate(reports: ItemReport[]): void {
  const totals: ScanUsage = { claudeInputTokens: 0, claudeOutputTokens: 0, geminiInputTokens: 0, geminiOutputTokens: 0 };
  let timedCount = 0;
  for (const r of reports) {
    if (!r.usage) continue;
    timedCount++;
    totals.claudeInputTokens += r.usage.claudeInputTokens;
    totals.claudeOutputTokens += r.usage.claudeOutputTokens;
    totals.geminiInputTokens += r.usage.geminiInputTokens;
    totals.geminiOutputTokens += r.usage.geminiOutputTokens;
  }
  if (timedCount === 0) return;

  const claudeCost = estimateCostUsd(totals.claudeInputTokens, totals.claudeOutputTokens, CLAUDE_SONNET_PRICE);
  const geminiCost = estimateCostUsd(totals.geminiInputTokens, totals.geminiOutputTokens, GEMINI_PRICE);
  console.log(`\n--- Estimated cost (${timedCount}/${reports.length} entries; see pricing.ts for caveats) ---`);
  console.log(
    `  Claude: ${totals.claudeInputTokens} in / ${totals.claudeOutputTokens} out tokens — ~${formatUsd(claudeCost)}`
  );
  if (totals.geminiInputTokens > 0 || totals.geminiOutputTokens > 0) {
    console.log(
      `  Gemini: ${totals.geminiInputTokens} in / ${totals.geminiOutputTokens} out tokens — ~${formatUsd(geminiCost)}`
    );
  }
  console.log(`  Total: ~${formatUsd(claudeCost + geminiCost)}`);
}

async function main() {
  // Parsed/validated up front, before any real (paid) API call — a typo'd
  // threshold should fail immediately, not after spending the whole run's cost.
  const minPassRate = parseMinPassRateArg(process.argv);

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

  const overallPassRate = printSummary(reports);

  if (minPassRate === undefined) {
    return; // Default behavior, unchanged: a report, always exits 0.
  }
  if (overallPassRate === null) {
    console.log(`\n--min-pass-rate=${minPassRate} given, but nothing was gradable — treating as a failure.`);
    process.exitCode = 1;
    return;
  }
  if (overallPassRate < minPassRate) {
    console.log(
      `\nFAIL: overall pass rate ${overallPassRate.toFixed(1)}% is below --min-pass-rate=${minPassRate}.`
    );
    process.exitCode = 1;
  } else {
    console.log(`\nOK: overall pass rate ${overallPassRate.toFixed(1)}% meets --min-pass-rate=${minPassRate}.`);
  }
}

/** Parses `--min-pass-rate=<0-100>` from argv. Returns undefined if the flag
 * wasn't passed at all (the default, report-only mode) — throws on a
 * malformed value instead of silently ignoring it, since a typo'd threshold
 * that's silently never enforced is worse than a loud early failure. */
function parseMinPassRateArg(argv: string[]): number | undefined {
  const arg = argv.find((a) => a.startsWith("--min-pass-rate="));
  if (!arg) return undefined;
  const value = Number(arg.slice("--min-pass-rate=".length));
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`--min-pass-rate must be a number between 0 and 100, got "${arg}"`);
  }
  return value;
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exitCode = 1;
});
