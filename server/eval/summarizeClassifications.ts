// Reads server/data/classifications.jsonl (see server/src/lib/classificationLog.ts)
// and prints real-world usage-pattern stats: how often a scan comes back
// "unrecognized", how often Gemini's rescue pass or Vision's brand-fill signal
// fires, brandConfidence distribution, etc. Purely local analysis — no network
// calls, unlike runEval.ts, since it only reads data already logged by the
// running server.
//
// Deliberately lives outside server/src for the same reason as runEval.ts
// (server/tsconfig.json's rootDir/include are scoped to "src") — a dev-only
// tool, never part of the deployed server.
//
// Run via `npm run summarize --workspace=server`.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrandConfidence, ClassificationResult } from "@clothing-scanner/shared-types";
import type { ClassificationLogEntry, ScanUsage } from "../src/lib/classificationLog.js";
import { CLAUDE_HAIKU_PRICE, CLAUDE_SONNET_PRICE, GEMINI_PRICE, estimateCostUsd, formatUsd } from "./pricing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = join(__dirname, "..", "data", "classifications.jsonl");

function pct(count: number, total: number): string {
  return total === 0 ? "n/a" : `${count}/${total} (${Math.round((count / total) * 100)}%)`;
}

function main() {
  if (!existsSync(LOG_FILE)) {
    console.log(`No log yet at ${LOG_FILE} — it's created on first successful /classify or /barcode-lookup call.`);
    return;
  }

  const lines = readFileSync(LOG_FILE, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const entries: ClassificationLogEntry[] = lines.map((l) => JSON.parse(l));

  if (entries.length === 0) {
    console.log("Log file exists but has no entries yet.");
    return;
  }

  const total = entries.length; // total SCANS, not total items — a "classify" scan can log 0-N items
  // Flatten to one entry per detected item across all scans, for the per-item stats
  // below (brand source/confidence, rescue flags). A "classify" scan that found
  // nothing contributes zero entries here, not a placeholder — that's what the
  // zero-items rate below measures instead.
  const results: ClassificationResult[] = entries.flatMap((e) => e.result);

  console.log(`Total logged scans: ${total} (${results.length} total detected item(s) across them)`);

  const byTrigger = new Map<string, number>();
  for (const e of entries) byTrigger.set(e.trigger, (byTrigger.get(e.trigger) ?? 0) + 1);
  console.log("\nBy trigger:");
  for (const [trigger, count] of byTrigger) {
    console.log(`  ${trigger}: ${pct(count, total)}`);
  }

  const classifyEntries = entries.filter((e) => e.trigger === "classify");
  const zeroItemScans = classifyEntries.filter((e) => Array.isArray(e.result) && e.result.length === 0).length;
  console.log(`\nZero-items rate (photo scans that found nothing at all): ${pct(zeroItemScans, classifyEntries.length)}`);
  const itemCounts = classifyEntries.map((e) => (Array.isArray(e.result) ? e.result.length : 1));
  const avgItems = itemCounts.length === 0 ? 0 : itemCounts.reduce((a, b) => a + b, 0) / itemCounts.length;
  console.log(`Average items detected per photo scan: ${avgItems.toFixed(2)}`);

  const geminiRescued = results.filter((r) => r.model === "gemini-3.1-pro").length;
  const visionAssisted = results.filter((r) => r.visionAssisted === true).length;
  console.log(`Gemini rescue used: ${pct(geminiRescued, total)}`);
  console.log(`Vision-hint retry resolved it: ${pct(visionAssisted, total)}`);

  const brandSourceCounts = new Map<string, number>();
  for (const r of results) {
    const key = r.brandSource ?? "primary model's own guess";
    brandSourceCounts.set(key, (brandSourceCounts.get(key) ?? 0) + 1);
  }
  console.log("\nBrand source breakdown:");
  for (const [source, count] of brandSourceCounts) {
    console.log(`  ${source}: ${pct(count, total)}`);
  }

  const confidenceCounts = new Map<BrandConfidence, number>();
  for (const r of results) confidenceCounts.set(r.brandConfidence, (confidenceCounts.get(r.brandConfidence) ?? 0) + 1);
  console.log("\nBrand confidence distribution:");
  for (const level of ["none", "low", "medium", "high"] as const) {
    console.log(`  ${level}: ${pct(confidenceCounts.get(level) ?? 0, total)}`);
  }

  // Latency — only present on entries logged after latencyMs was added to
  // ClassificationLogEntry (classificationLog.ts), so older log lines are
  // silently skipped here rather than treated as 0ms.
  printLatencySummary(entries);

  // Cost — same "only present on entries logged after the field existed" caveat.
  printCostSummary(entries);
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarizeLatencies(label: string, values: number[]): void {
  if (values.length === 0) {
    console.log(`  ${label}: n/a (no timed entries)`);
    return;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  console.log(
    `  ${label}: avg ${Math.round(avg)}ms, median ${Math.round(median(sorted))}ms, ` +
      `min ${sorted[0]}ms, max ${sorted[sorted.length - 1]}ms (n=${values.length})`
  );
}

/** Buckets logged latency by which rescue path eventually resolved the scan —
 * the exact tradeoff claudeClient.ts's own comments describe having measured by
 * hand once (Gemini-on-every-scan pushing average latency from ~2.2-2.6s to
 * 3-7.7s, hence demoting it to rescue-only). This gives that same comparison an
 * ongoing, durable source instead of a one-time manual measurement. */
function printLatencySummary(entries: ClassificationLogEntry[]): void {
  const timed = entries.filter((e): e is ClassificationLogEntry & { latencyMs: number } => e.latencyMs !== undefined);
  console.log(`\nLatency (${timed.length}/${entries.length} logged entries have timing data):`);
  if (timed.length === 0) return;

  summarizeLatencies("Overall", timed.map((e) => e.latencyMs));

  const barcodeLatencies = timed.filter((e) => e.trigger === "barcode-lookup").map((e) => e.latencyMs);
  summarizeLatencies("barcode-lookup", barcodeLatencies);

  const classifyTimed = timed.filter((e) => e.trigger === "classify");
  const primaryModel = (e: ClassificationLogEntry): ClassificationResult["model"] | undefined =>
    Array.isArray(e.result) ? e.result[0]?.model : e.result.model;

  summarizeLatencies(
    "classify — claude-sonnet-5 (no rescue)",
    classifyTimed.filter((e) => primaryModel(e) === "claude-sonnet-5" && !(Array.isArray(e.result) ? e.result[0]?.visionAssisted : e.result.visionAssisted)).map((e) => e.latencyMs)
  );
  summarizeLatencies(
    "classify — Vision-hint retry resolved it",
    classifyTimed.filter((e) => Array.isArray(e.result) ? e.result[0]?.visionAssisted : e.result.visionAssisted).map((e) => e.latencyMs)
  );
  summarizeLatencies(
    "classify — Gemini rescue resolved it",
    classifyTimed.filter((e) => primaryModel(e) === "gemini-3.1-pro").map((e) => e.latencyMs)
  );
  summarizeLatencies(
    "classify — zero items found",
    classifyTimed.filter((e) => Array.isArray(e.result) && e.result.length === 0).map((e) => e.latencyMs)
  );
}

function sumUsage(usages: ScanUsage[]): ScanUsage {
  const total: ScanUsage = { claudeInputTokens: 0, claudeOutputTokens: 0, geminiInputTokens: 0, geminiOutputTokens: 0 };
  for (const u of usages) {
    total.claudeInputTokens += u.claudeInputTokens;
    total.claudeOutputTokens += u.claudeOutputTokens;
    total.geminiInputTokens += u.geminiInputTokens;
    total.geminiOutputTokens += u.geminiOutputTokens;
  }
  return total;
}

/** Reports $ for a bucket of entries, using Sonnet pricing for the Claude
 * side (both classifyImage's rescue chain and barcode-lookup's normalization
 * pass — barcode-lookup actually uses Haiku, priced separately below, since
 * lumping the two together would understate barcode-lookup's real cost and
 * overstate classify's). */
function summarizeCost(label: string, usages: ScanUsage[], claudePrice = CLAUDE_SONNET_PRICE): void {
  if (usages.length === 0) {
    console.log(`  ${label}: n/a (no entries)`);
    return;
  }
  const total = sumUsage(usages);
  const claudeCost = estimateCostUsd(total.claudeInputTokens, total.claudeOutputTokens, claudePrice);
  const geminiCost = estimateCostUsd(total.geminiInputTokens, total.geminiOutputTokens, GEMINI_PRICE);
  const totalCost = claudeCost + geminiCost;
  console.log(
    `  ${label}: ~${formatUsd(totalCost)} total, ~${formatUsd(totalCost / usages.length)}/scan (n=${usages.length})`
  );
}

/** Same rescue-path buckets as printLatencySummary above — the two sections
 * are meant to be read side by side (a rescue path that's both slower AND
 * more expensive is the clearest signal that a tradeoff needs revisiting,
 * same kind of live measurement that originally justified moving Gemini to
 * rescue-only — see claudeClient.ts's classifyImage doc comment). */
function printCostSummary(entries: ClassificationLogEntry[]): void {
  const timed = entries.filter((e): e is ClassificationLogEntry & { usage: ScanUsage } => e.usage !== undefined);
  console.log(`\nEstimated cost (${timed.length}/${entries.length} logged entries have usage data; see pricing.ts for caveats):`);
  if (timed.length === 0) return;

  summarizeCost("Overall", timed.map((e) => e.usage));

  const barcodeEntries = timed.filter((e) => e.trigger === "barcode-lookup");
  summarizeCost("barcode-lookup (Haiku)", barcodeEntries.map((e) => e.usage), CLAUDE_HAIKU_PRICE);

  const classifyTimed = timed.filter((e) => e.trigger === "classify");
  const primaryModel = (e: ClassificationLogEntry): ClassificationResult["model"] | undefined =>
    Array.isArray(e.result) ? e.result[0]?.model : e.result.model;
  const visionAssisted = (e: ClassificationLogEntry): boolean =>
    Array.isArray(e.result) ? Boolean(e.result[0]?.visionAssisted) : Boolean(e.result.visionAssisted);

  summarizeCost(
    "classify — claude-sonnet-5 (no rescue)",
    classifyTimed.filter((e) => primaryModel(e) === "claude-sonnet-5" && !visionAssisted(e)).map((e) => e.usage)
  );
  summarizeCost(
    "classify — Vision-hint retry resolved it",
    classifyTimed.filter((e) => visionAssisted(e)).map((e) => e.usage)
  );
  summarizeCost(
    "classify — Gemini rescue resolved it",
    classifyTimed.filter((e) => primaryModel(e) === "gemini-3.1-pro").map((e) => e.usage)
  );
  summarizeCost(
    "classify — zero items found",
    classifyTimed.filter((e) => Array.isArray(e.result) && e.result.length === 0).map((e) => e.usage)
  );
}

main();
