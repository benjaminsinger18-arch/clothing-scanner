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
  /** Which model produced this result — useful for debugging escalation logic.
   * "gemini-3.1-pro" means Claude's own pass came back "unrecognized" and Gemini's
   * independent second opinion (run concurrently, see classifyImage) succeeded
   * where Claude didn't — the whole result is Gemini's, not just a hint-assisted
   * Claude retry. */
  model: "claude-haiku-4-5" | "claude-sonnet-5" | "gemini-3.1-pro";
  /** True when Claude's first pass came back "unrecognized" and Google Cloud Vision's
   * web/label detection (fetched concurrently with that first pass) supplied a hint
   * that let a second Claude pass identify the item after all. Absent/false when no
   * rescue pass was needed (or it didn't help) — including when Gemini rescued the
   * scan instead (see `model`), since that's a different mechanism than this flag
   * documents. */
  visionAssisted?: boolean;
  /** Present when brandGuess/brandConfidence were filled in or upgraded from a
   * source other than the primary result's own judgment (only happens when the
   * primary result's own brandConfidence was "none" or "low"):
   *   - "vision-logo" — Google Cloud Vision's logo detection. Softened to "low"
   *     confidence regardless of Vision's own score — an unvalidated opinion.
   *   - "gemini" — Gemini's independent classification confidently named a brand
   *     Claude didn't. Softened a confidence notch on the way in (see
   *     applyBrandCrossValidation in claudeClient.ts) — also an unvalidated
   *     opinion, just a stronger one than Vision's raw logo match.
   *   - "barcode" — UPCitemdb's own `brand` field on an exact UPC match. Unlike
   *     the other two, this is ground truth, not an opinion — always paired with
   *     brandConfidence: "high", never softened.
   * Absent means the brand guess is entirely the primary model's own. */
  brandSource?: "vision-logo" | "gemini" | "barcode";
  /** How this whole classification was produced. Absent/"photo" = today's default:
   * AI visual judgment on a captured image. "barcode" = every field came from a
   * UPCitemdb match plus a text-only normalization pass (see classifyFromBarcode
   * in claudeClient.ts) — no image was ever looked at for this result. "correction"
   * = the user disputed a prior (wrong) classification and typed what it actually
   * is; that correction was verified against a real web search before being
   * structured into this result (see verifyCorrection in claudeClient.ts) — the
   * strongest provenance in this list, since it's both user-asserted and
   * independently checked, not just visual inference or a database lookup. */
  source?: "photo" | "barcode" | "correction";
  /** Present only when source === "correction" and the verification search
   * actually surfaced usable results: up to 3 web sources (deduped by URL) that
   * corroborated the corrected classification, so the app can show its work
   * rather than asking the user to trust a bare re-guess. Absent whenever source
   * isn't "correction", or when it is but the research turned up nothing citable. */
  sources?: { title: string; url: string }[];
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

/** Body shape for POST /correct-classification — the user's free-text correction
 * plus the full original (disputed) classification, sent along so the
 * verification pass has context for what it's correcting rather than starting
 * from nothing. */
export interface CorrectionRequestBody {
  correctionText: string;
  original: ClassificationResult;
}

export interface ApiErrorBody {
  error: string;
  reason?: string;
}
