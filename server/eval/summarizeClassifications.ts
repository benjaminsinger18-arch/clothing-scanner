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
import type { ClassificationLogEntry } from "../src/lib/classificationLog.js";

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

  const total = entries.length;
  const results: ClassificationResult[] = entries.map((e) => e.result);

  console.log(`Total logged classifications: ${total}`);

  const byTrigger = new Map<string, number>();
  for (const e of entries) byTrigger.set(e.trigger, (byTrigger.get(e.trigger) ?? 0) + 1);
  console.log("\nBy trigger:");
  for (const [trigger, count] of byTrigger) {
    console.log(`  ${trigger}: ${pct(count, total)}`);
  }

  const unrecognized = results.filter((r) => r.garmentType === "unrecognized").length;
  console.log(`\nUnrecognized rate: ${pct(unrecognized, total)}`);

  const geminiRescued = results.filter((r) => r.model === "gemini-3.1-pro").length;
  const visionAssisted = results.filter((r) => r.visionAssisted === true).length;
  const fashionClipAssisted = results.filter((r) => r.fashionClipAssisted === true).length;
  console.log(`Gemini rescue used: ${pct(geminiRescued, total)}`);
  console.log(`Vision-hint retry resolved it: ${pct(visionAssisted, total)}`);
  console.log(`Fashion-CLIP last-resort retry resolved it: ${pct(fashionClipAssisted, total)}`);

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
}

main();
