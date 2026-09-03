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
  /** True when Claude's first pass came back "unrecognized" and Google Cloud Vision's
   * web/label detection (fetched concurrently with that first pass) supplied a hint
   * that let a second Claude pass identify the item after all. Absent/false when no
   * rescue pass was needed (or it didn't help). */
  visionAssisted?: boolean;
  /** Present and set to "vision-logo" when brandGuess/brandConfidence were filled in
   * or upgraded from Google Cloud Vision's logo detection rather than Claude's own
   * judgment (only happens when Claude's own brandConfidence was "none" or "low").
   * Absent means the brand guess is entirely Claude's. Treat a "vision-logo" guess
   * as unvalidated against the image's actual context by Claude — distinct from a
   * guess Claude itself vouches for. */
  brandSource?: "vision-logo";
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

export interface PriceRange {
  low: number;
  median: number;
  high: number;
  currency: string;
}

export interface PriceSearchResult {
  status: DataSourceStatus;
  /** Aggregated from all-condition eBay listings — mostly secondhand, so this is a
   * resale/secondhand market value, NOT a retail/brand-new price estimate. */
  estimatedResaleRange?: PriceRange;
  /** Aggregated from eBay listings filtered to new/new-with-tags condition only.
   * Undefined when no new listings were found for this item. */
  estimatedNewRange?: PriceRange;
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

/** Body shape for POST /outfit-suggestions — the classification fields needed to
 * describe the item to Claude for complementary-item suggestions. */
export interface OutfitSuggestionsRequestBody {
  garmentType: string;
  category: string;
  color: string;
  pattern: string;
  style: string;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}

export interface ApiErrorBody {
  error: string;
  reason?: string;
}
