// Types shared between the Express backend and the Expo app.
// Kept dependency-free (no imports) so it can be used from either environment.

export type BrandConfidence = "none" | "low" | "medium" | "high";

/** Sentinel garment_type value Claude returns when the photo isn't a recognizable
 * piece of clothing (wrong subject, unusable image, etc). The app should treat
 * this as "ask the user to retake the photo" rather than rendering results. */
export const UNRECOGNIZED_GARMENT = "unrecognized" as const;

export interface ClassificationResult {
  garmentType: string | typeof UNRECOGNIZED_GARMENT;
  category: string;
  color: string;
  pattern: string;
  style: string;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
  /** Which model produced this result — useful for debugging escalation logic. */
  model: "claude-haiku-4-5" | "claude-sonnet-5";
}

export interface PriceListing {
  source: "ebay" | "serpapi";
  title: string;
  price: number;
  currency: string;
  url: string;
  imageUrl?: string;
  condition?: string;
  rating?: number;
  reviewCount?: number;
}

export type DataSourceStatus = "ok" | "rate_limited" | "unavailable" | "no_results";

export interface PriceSearchResult {
  status: DataSourceStatus;
  estimatedPriceRange?: { low: number; median: number; high: number; currency: string };
  similarItems: PriceListing[];
  reviews: PriceListing[];
}

export interface OutfitSuggestion {
  keywords: string; // e.g. "navy chino pants"
  items: PriceListing[];
}

export interface OutfitSuggestionsResult {
  status: DataSourceStatus;
  suggestions: OutfitSuggestion[];
}

export interface ScanResult {
  classification: ClassificationResult;
  pricing?: PriceSearchResult;
  outfits?: OutfitSuggestionsResult;
}

export interface ClassifyRequestBody {
  imageBase64: string;
  mediaType?: "image/jpeg" | "image/png" | "image/webp";
}

/** Query shape for GET /price-search — the subset of ClassificationResult needed
 * to build a product search, sent as query params (see PriceSearchQueryKeys). */
export interface PriceSearchQuery {
  garmentType: string;
  category: string;
  color: string;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}

export interface ApiErrorBody {
  error: string;
  reason?: string;
}
