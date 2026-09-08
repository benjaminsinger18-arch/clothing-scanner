// Promotes real user-submitted corrections (server/data/corrections.jsonl) into
// the golden eval set (server/eval/golden/) — the "consume" half of the
// correction-logging infrastructure that's existed since early in this
// project but had nothing reading from it. Both correctionLog.ts's own doc
// comment and golden/README.md describe this as a future step; this script is
// that step.
//
// Dry-run by default: prints every promotable correction (garment type,
// category, whether it's new coverage vs. a combo the golden set already has)
// without writing anything. Pass --apply to actually copy images into
// golden/images/ and append entries to golden/labels.json. This is a
// deliberate human-in-the-loop step, not a fully automatic pipeline —
// a correction's photo is a real user's own (or a friend's) phone photo of
// their belongings, not an openly-licensed stock photo like every existing
// golden-set entry, so copying it straight into a git-committed set is worth
// a human glance first.
//
// Run via `npm run promote-corrections --workspace=server` (dry run) or
// `npm run promote-corrections --workspace=server -- --apply`. Pass
// --include-covered to also promote corrections whose garmentType/category
// combo is already represented in the golden set (skipped by default, so a
// single busy day of corrections doesn't flood the set with near-duplicates).
//
// KNOWN LIMITATION: correctionLog.ts only stores the compressed *thumbnail*
// (160px, quality 0.4 — see compressForThumbnail in app/lib/compressImage.ts),
// not the full-resolution photo the server actually classified, to bound the
// log file's growth. Promoted images are therefore lower-resolution than the
// rest of golden/images/ (curated at 1280px/quality 85 across nine expansion
// rounds — see golden/ATTRIBUTIONS.md) — still a real photo of a real
// misclassification, just visibly softer if you open it directly.
//
// Deliberately lives outside server/src (see runEval.ts's own comment on
// why) — a dev-only tool, never part of the deployed server or its typecheck.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { CorrectionLogEntry } from "../src/lib/correctionLog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORRECTIONS_LOG = join(__dirname, "..", "data", "corrections.jsonl");
const GOLDEN_DIR = join(__dirname, "golden");
const LABELS_FILE = join(GOLDEN_DIR, "labels.json");
const IMAGES_DIR = join(GOLDEN_DIR, "images");
// Small manifest of already-promoted correction ids, committed alongside
// labels.json — without this, re-running the script (e.g. after a later
// batch of corrections comes in) would re-promote the same early entries.
const PROMOTED_FILE = join(GOLDEN_DIR, "promoted-corrections.json");

// Mirrors runEval.ts's GoldenEntry shape exactly (style/brandConfidence
// deliberately excluded — see golden/README.md's grading-rules section for
// why: style is "too subjective to grade," brandConfidence is "never graded
// pass/fail, only reported as a calibration signal").
interface GoldenEntry {
  filename: string;
  expected: {
    garmentType?: string;
    category?: string;
    color?: string;
    pattern?: string;
    gender?: string;
    brandGuess?: string | null;
  };
}

function readJsonlIfExists<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

function readJsonArrayIfExists<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/** Stable id for dedup across runs. Hashes timestamp + correction text rather
 * than relying on timestamp alone, so this stays correct even if the
 * timestamp format or granularity ever changes upstream. */
function correctionId(entry: CorrectionLogEntry): string {
  return createHash("sha1")
    .update(entry.timestamp + entry.correctionText)
    .digest("hex")
    .slice(0, 16);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function comboKey(garmentType: string, category: string): string {
  return `${garmentType.toLowerCase()}|${category.toLowerCase()}`;
}

function main() {
  const applyMode = process.argv.includes("--apply");
  const includeCovered = process.argv.includes("--include-covered");

  const corrections = readJsonlIfExists<CorrectionLogEntry>(CORRECTIONS_LOG);
  if (corrections.length === 0) {
    console.log(
      existsSync(CORRECTIONS_LOG)
        ? "Corrections log exists but has no entries yet."
        : `No corrections log yet at ${CORRECTIONS_LOG} — it's created on the first successful correction submission. Nothing to promote.`
    );
    return;
  }

  const labels = readJsonArrayIfExists<GoldenEntry>(LABELS_FILE);
  const existingCombos = new Set(labels.map((l) => comboKey(l.expected.garmentType ?? "", l.expected.category ?? "")));

  const promoted = readJsonArrayIfExists<string>(PROMOTED_FILE);
  const promotedSet = new Set(promoted);

  let newCoverageCount = 0;
  let alreadyCoveredCount = 0;
  let skippedNoPhoto = 0;
  let skippedAlreadyPromoted = 0;
  const newLabels: GoldenEntry[] = [];
  const newPromotedIds: string[] = [];

  for (const entry of corrections) {
    const id = correctionId(entry);
    if (promotedSet.has(id)) {
      skippedAlreadyPromoted++;
      continue;
    }
    if (!entry.photoThumbnail) {
      skippedNoPhoto++;
      continue;
    }

    const combo = comboKey(entry.corrected.garmentType, entry.corrected.category);
    const isNewCoverage = !existingCombos.has(combo);
    if (isNewCoverage) newCoverageCount++;
    else alreadyCoveredCount++;

    if (!isNewCoverage && !includeCovered) continue;

    const filename = `correction-${slugify(entry.corrected.garmentType)}-${id.slice(0, 8)}.jpg`;
    console.log(
      `${isNewCoverage ? "[NEW COVERAGE]" : "[already covered]"} ${entry.timestamp} — "${entry.correctionText}" -> ` +
        `${entry.corrected.garmentType} / ${entry.corrected.category} / ${entry.corrected.color}` +
        (applyMode ? ` -> ${filename}` : "")
    );

    if (applyMode) {
      const base64 = entry.photoThumbnail.replace(/^data:image\/\w+;base64,/, "");
      mkdirSync(IMAGES_DIR, { recursive: true });
      writeFileSync(join(IMAGES_DIR, filename), Buffer.from(base64, "base64"));
      newLabels.push({
        filename,
        expected: {
          garmentType: entry.corrected.garmentType,
          category: entry.corrected.category,
          color: entry.corrected.color,
          pattern: entry.corrected.pattern,
          gender: entry.corrected.gender,
          brandGuess: entry.corrected.brandGuess,
        },
      });
      newPromotedIds.push(id);
      existingCombos.add(combo); // Don't promote several near-duplicates in one run.
    }
  }

  console.log(
    `\n${newCoverageCount} new-coverage correction(s), ${alreadyCoveredCount} already-covered, ` +
      `${skippedNoPhoto} skipped (no photo attached), ${skippedAlreadyPromoted} already promoted in a past run.`
  );

  if (!applyMode) {
    console.log("\nDry run — nothing written. Re-run with --apply to copy images and append to labels.json.");
    if (!includeCovered && alreadyCoveredCount > 0) {
      console.log(
        `(${alreadyCoveredCount} already-covered correction(s) weren't listed above — pass --include-covered to see/promote them too.)`
      );
    }
    return;
  }

  if (newLabels.length === 0) {
    console.log("Nothing new to write.");
    return;
  }

  writeFileSync(LABELS_FILE, JSON.stringify([...labels, ...newLabels], null, 2) + "\n");
  writeFileSync(PROMOTED_FILE, JSON.stringify([...promoted, ...newPromotedIds], null, 2) + "\n");
  console.log(
    `\nWrote ${newLabels.length} new image(s) to ${IMAGES_DIR} and appended ${newLabels.length} entry/entries to ${LABELS_FILE}.\n` +
      'Still manual: add an ATTRIBUTIONS.md row for each (source: "user correction", not Wikimedia Commons — no attribution ' +
      "needed, but worth a note distinguishing it from the rest of the set) and update both READMEs' photo-count mentions, " +
      "same as every prior golden-set expansion round."
  );
}

main();
