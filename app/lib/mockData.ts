// Placeholder data for tabs not wired to a real backend yet. Price Comparison,
// Similar Items, and Reviews now use real eBay + SerpApi data (Phases 2-3, see
// ResultsScreen). Outfit Matches remains mocked until outfit pairing (Phase 4).
// Clearly labeled as mock in the UI so it's never mistaken for real results.
import type { OutfitSuggestion } from "@clothing-scanner/shared-types";

export const MOCK_OUTFIT_SUGGESTIONS: OutfitSuggestion[] = [
  {
    keywords: "navy chino pants",
    items: [{ source: "ebay", title: "Navy chinos", price: 32.0, currency: "USD", url: "https://example.com" }],
  },
  {
    keywords: "white leather sneakers",
    items: [{ source: "serpapi", title: "White sneakers", price: 55.0, currency: "USD", url: "https://example.com" }],
  },
];
