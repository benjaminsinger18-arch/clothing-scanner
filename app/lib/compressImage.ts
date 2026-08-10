import * as ImageManipulator from "expo-image-manipulator";

/** Upper bound on the base64 payload we're willing to send. Keeps upload time
 * reasonable on slow/cellular connections and caps Claude vision token cost
 * (larger images cost more tokens). ~700KB base64 is comfortably under
 * eyeballed 1-2s upload time even on a slow connection, while still being
 * plenty of detail for garment classification. */
const TARGET_BASE64_BYTES = 700_000;

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
