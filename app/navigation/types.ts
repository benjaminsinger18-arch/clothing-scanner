import type { ClassificationResult, OutfitSuggestionsResult, PriceSearchResult } from "@clothing-scanner/shared-types";
import type { ClosetItem } from "../lib/closetStorage";

export type RootStackParamList = {
  Capture: undefined;
  Preview: { photoUri: string };
  BarcodeScan: undefined;
  /** One photo can now report several distinct clothing items (see classifyImage
   * in claudeClient.ts) — classifications is always at least length 1 by the time
   * anything navigates here (an empty result is handled as an error before
   * reaching Results, see PreviewScreen/BarcodeScanScreen). prefetchedPricing/
   * prefetchedOutfits are optional and correspond ONLY to `initialIndex` — set by
   * every screen that navigates here after producing a classification (see
   * prefetchResultsData in app/lib/prefetchResults.ts), so ResultsScreen's initial
   * load can await that one already-in-flight request instead of starting a fresh
   * one after mounting. Every other item's pricing/outfits are fetched lazily,
   * on demand, only once the user actually selects that item (see ResultsScreen —
   * this is deliberate, not an oversight: prefetching every detected item would
   * multiply SerpApi calls by however many items are in the photo, against a tight
   * shared monthly quota). */
  Results: {
    classifications: ClassificationResult[];
    /** Which item to show first — defaults to 0 if omitted. The ONLY item
     * prefetchedPricing/prefetchedOutfits below correspond to. */
    initialIndex?: number;
    prefetchedPricing?: Promise<PriceSearchResult>;
    prefetchedOutfits?: Promise<OutfitSuggestionsResult>;
    /** A small data: URI thumbnail of the actual scanned photo (see
     * compressForThumbnail in app/lib/compressImage.ts) — absent for
     * barcode-identified items, which never had a garment photo to begin
     * with. One photo per scan, shared across every detected item — there's no
     * per-item crop, so every item saved to the Closet from one multi-item scan
     * shows the same source photo. Forwarded on to Correction (and back from it)
     * so a re-submitted classification still shows the same photo. */
    photoThumbnail?: string;
  };
  Correction: {
    /** The one disputed item — equivalent to allClassifications[itemIndex]. */
    classification: ClassificationResult;
    /** The full sibling set from the same scan, needed only so the corrected
     * result can be spliced back into the right slot before returning to
     * Results — CorrectionScreen's own logic still only ever handles the one
     * `classification` above, unchanged from before multi-item existed. */
    allClassifications: ClassificationResult[];
    itemIndex: number;
    photoThumbnail?: string;
  };
  Closet: undefined;
  /** The full saved entry, passed directly rather than just an id — same
   * pattern as Results/Correction passing a whole classification through nav
   * params — so this screen needs no extra AsyncStorage read of its own for
   * the common case of "I just tapped this from the list I already loaded." */
  ClosetDetail: { item: ClosetItem };
};
