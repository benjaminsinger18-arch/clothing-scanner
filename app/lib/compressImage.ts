import * as ImageManipulator from "expo-image-manipulator";

/** Upper bound on the base64 payload we're willing to send. A typical garment
 * photo (high-frequency texture — knit, denim weave, logos) at the first
 * preset's 1280px/0.8 can plausibly run up to ~1.1MB base64, so the budget
 * needs real headroom above that or most photos fall through to extra
 * decode/resize/encode passes for no benefit — each pass re-decodes the full
 * original and adds real latency before the upload even starts. 1.2MB base64
 * clears that first-pass ceiling in the common case while still bounding
 * upload time/vision token cost, and the smaller presets below remain a
 * safety net for genuine outliers (unusually large/detailed originals). */
const TARGET_BASE64_BYTES = 1_200_000;

/** Presets tried in order, largest/highest-quality first. Each is a fresh
 * pass over the *original* uri (not chained off the previous pass's output)
 * so quality loss doesn't compound across attempts. The preferred preset is
 * 1280px/0.8 — bumped up from an earlier 1024px baseline to give the
 * classifier more fine detail to work with (exact color, garment cut/
 * construction), since misclassification mattered more than the small
 * latency/token cost of a modestly larger single request. Smaller presets
 * remain a safety net for photos still large after that (e.g. big phone
 * camera originals), while leaving typical photos untouched — most still
 * fit in the first pass. */
const PRESETS: { width: number; compress: number }[] = [
  { width: 1280, compress: 0.8 },
  { width: 1024, compress: 0.6 },
  { width: 768, compress: 0.55 },
  { width: 600, compress: 0.5 },
];

/** Resizes/re-encodes as JPEG and returns base64 (no data: URL prefix) ready
 * to send to the backend. Tries presets from largest to smallest, stopping
 * as soon as one fits under TARGET_BASE64_BYTES; falls back to the smallest
 * preset's output if none do (best effort rather than failing the upload).
 *
 * Logs total time and which preset index was used (__DEV__ only — this file
 * has no other logging today, and this is meant as a diagnostic for tuning
 * PRESETS/TARGET_BASE64_BYTES against real device numbers, not a production
 * metric). Each pass re-decodes the full original from scratch (see PRESETS'
 * comment), so falling through to a second/third pass is real, visible added
 * latency worth being able to see, not just guess at. */
export async function compressForUpload(uri: string): Promise<string> {
  const startedAt = Date.now();
  let last: string | undefined;

  for (let i = 0; i < PRESETS.length; i++) {
    const preset = PRESETS[i];
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
      if (__DEV__) {
        console.log(`[compressImage] ${Date.now() - startedAt}ms, preset ${i} (${preset.width}px/${preset.compress})`);
      }
      return result.base64;
    }
  }

  if (!last) {
    throw new Error("Failed to encode photo for upload");
  }
  if (__DEV__) {
    console.log(`[compressImage] ${Date.now() - startedAt}ms, fell through to smallest preset`);
  }
  return last;
}

// Deliberately much smaller than the upload presets above — this thumbnail is
// for on-screen display (Overview's photo, a saved Closet entry) and for
// persisting into AsyncStorage, not for the classifier, so there's no reason
// to spend the bytes upload quality needs. Kept small enough that a closet
// full of saved items (see closetStorage.ts's MAX_CLOSET_ITEMS) stays well
// under AsyncStorage's practical size ceiling.
const THUMBNAIL_WIDTH = 160;
const THUMBNAIL_COMPRESS = 0.4;

/** Small JPEG thumbnail as a ready-to-render `data:` URI (unlike
 * compressForUpload's bare base64) — usable directly as an <Image
 * source={{ uri }}> value with no further wrapping. */
export async function compressForThumbnail(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: THUMBNAIL_WIDTH } }], {
    compress: THUMBNAIL_COMPRESS,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  if (!result.base64) {
    throw new Error("Failed to encode thumbnail");
  }
  return `data:image/jpeg;base64,${result.base64}`;
}
