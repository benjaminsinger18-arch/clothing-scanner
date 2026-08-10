import * as ImageManipulator from "expo-image-manipulator";

/** Upper bound on the base64 payload we're willing to send. A typical garment
 * photo (high-frequency texture — knit, denim weave, logos) at the first
 * preset's 1024px/0.8 can plausibly run up to ~930KB base64, so the budget
 * needs real headroom above that or most photos fall through to extra
 * decode/resize/encode passes for no benefit — each pass re-decodes the full
 * original and adds real latency before the upload even starts. 1.2MB base64
 * clears that first-pass ceiling in the common case while still bounding
 * upload time/vision token cost, and the smaller presets below remain a
 * safety net for genuine outliers (unusually large/detailed originals). */
const TARGET_BASE64_BYTES = 1_200_000;

/** Presets tried in order, largest/highest-quality first. Each is a fresh
 * pass over the *original* uri (not chained off the previous pass's output)
 * so quality loss doesn't compound across attempts. Phase 1 baseline was a
 * single fixed 1024px/0.8 pass; this adds smaller fallbacks for photos that
 * are still large after that (e.g. big phone camera originals), while
 * leaving typical photos untouched — most already fit in the first pass. */
const PRESETS: { width: number; compress: number }[] = [
  { width: 1024, compress: 0.8 },
  { width: 1024, compress: 0.6 },
  { width: 768, compress: 0.55 },
  { width: 600, compress: 0.5 },
];

/** Resizes/re-encodes as JPEG and returns base64 (no data: URL prefix) ready
 * to send to the backend. Tries presets from largest to smallest, stopping
 * as soon as one fits under TARGET_BASE64_BYTES; falls back to the smallest
 * preset's output if none do (best effort rather than failing the upload). */
export async function compressForUpload(uri: string): Promise<string> {
  let last: string | undefined;

  for (const preset of PRESETS) {
    const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: preset.width } }], {
      compress: preset.compress,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });

    if (!result.base64) {
      continue;
    }
    last = result.base64;
    if (result.base64.length <= TARGET_BASE64_BYTES) {
      return result.base64;
    }
  }

  if (!last) {
    throw new Error("Failed to encode photo for upload");
  }
  return last;
}
