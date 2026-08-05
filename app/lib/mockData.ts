// Placeholder data for tabs not wired to a real backend yet. Similar Items and Price
// Comparison now use real eBay data as of Phase 2 (see ResultsScreen); Reviews and
// Outfit Matches remain mocked until SerpApi (Phase 3) and outfit pairing (Phase 4).
// Clearly labeled as mock in the UI so it's never mistaken for real results.
import type { OutfitSuggestion, PriceListing } from "@clothing-scanner/shared-types";

export const MOCK_REVIEWS: PriceListing[] = [
  {
    source: "serpapi",
    title: "Sample review snippet",
    price: 0,
    currency: "USD",
    url: "https://example.com",
    rating: 4.3,
    reviewCount: 128,
  },
];

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
