import type { ClassificationResult, OutfitSuggestionsResult, PriceSearchResult } from "@clothing-scanner/shared-types";
import type { ErrorInfo } from "../lib/errors";

export type RootStackParamList = {
  Capture: undefined;
  Preview: { photoUri: string };
  Results: {
    classification: ClassificationResult;
    // Prefetched by PreviewScreen (kicked off right after classification, in
    // parallel) so tabs render instantly instead of showing a second round of
    // spinners. Absent only if something threw before the fetches even started.
    prefetchedPricing?: PriceSearchResult | null;
    prefetchedPricingError?: ErrorInfo | null;
    prefetchedOutfits?: OutfitSuggestionsResult | null;
    prefetchedOutfitsError?: ErrorInfo | null;
  };
};
