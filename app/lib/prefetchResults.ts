import type { ClassificationResult, OutfitSuggestionsResult, PriceSearchResult } from "@clothing-scanner/shared-types";
import { getOutfitSuggestions, searchPrices } from "../services/api";

/** Kicks off the Results screen's two data fetches the instant a classification
 * is available, rather than waiting for the Results screen to mount and its own
 * useEffects to fire — the screen-transition/mount cycle is otherwise dead time
 * these fetches could already be using, since neither depends on anything from
 * the Results screen itself, only on `classification`. Called from every screen
 * that navigates to Results after producing one (Preview, BarcodeScan,
 * Correction) — spread the result into that navigation call's params. Fetch
 * errors are intentionally NOT caught here; ResultsScreen's own error handling
 * (on whichever of these promises it awaits) is what surfaces them, same as it
 * already does for a non-prefetched fetch. */
export function prefetchResultsData(classification: ClassificationResult): {
  prefetchedPricing: Promise<PriceSearchResult>;
  prefetchedOutfits: Promise<OutfitSuggestionsResult>;
} {
  return {
    prefetchedPricing: searchPrices(classification),
    prefetchedOutfits: getOutfitSuggestions(classification),
  };
}
