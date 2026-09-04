import type { ClassificationResult, OutfitSuggestionsResult, PriceSearchResult } from "@clothing-scanner/shared-types";

export type RootStackParamList = {
  Capture: undefined;
  Preview: { photoUri: string };
  BarcodeScan: undefined;
  /** prefetchedPricing/prefetchedOutfits are optional — set by every screen that
   * navigates here after producing a classification (see prefetchResultsData in
   * app/lib/prefetchResults.ts), so ResultsScreen's initial load can await
   * already-in-flight requests instead of starting fresh ones after mounting. */
  Results: {
    classification: ClassificationResult;
    prefetchedPricing?: Promise<PriceSearchResult>;
    prefetchedOutfits?: Promise<OutfitSuggestionsResult>;
    /** A small data: URI thumbnail of the actual scanned photo (see
     * compressForThumbnail in app/lib/compressImage.ts) — absent for
     * barcode-identified items, which never had a garment photo to begin
     * with. Forwarded on to Correction (and back from it) so a re-submitted
     * classification still shows the same photo. */
    photoThumbnail?: string;
  };
  Correction: { classification: ClassificationResult; photoThumbnail?: string };
  Closet: undefined;
};
