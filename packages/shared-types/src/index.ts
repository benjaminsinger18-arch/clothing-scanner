// Types shared between the Express backend and the Expo app.
// Kept dependency-free (no imports) so it can be used from either environment.

export type BrandConfidence = "none" | "low" | "medium" | "high";

/** Who a garment is styled/cut for — drives gendered outfit-pairing suggestions
 * (see OutfitSuggestionsRequestBody). "unisex" is a genuine category (the item is
 * gender-neutral in styling), not a fallback for uncertainty — see
 * classificationSchema.ts's field description for how models are instructed to
 * use it. */
export type Gender = "men" | "women" | "unisex";

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
  /** Who this garment is styled/cut for — see the Gender type doc. Always present:
   * every classification path (photo, Gemini rescue, barcode, correction) shares
   * the same forced-schema tool, which requires this field. */
  gender: Gender;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
  /** Which model produced this result — useful for debugging escalation logic.
   * "gemini-3.1-pro" means Claude's own pass came back "unrecognized" and Gemini's
   * independent second opinion (only called on this rescue path, see classifyImage)
   * succeeded where Claude didn't — the whole result is Gemini's, not just a
   * hint-assisted Claude retry. */
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
   *   - "barcode" — UPCitemdb's own `brand` field on an exact UPC match. Unlike
   *     "vision-logo", this is ground truth, not an opinion — always paired with
   *     brandConfidence: "high", never softened.
   * Absent means the brand guess is entirely the primary model's own — including
   * whenever `model` is "gemini-3.1-pro", since that's Gemini's own judgment as a
   * rescue result, not a secondary opinion layered onto something else. */
  brandSource?: "vision-logo" | "barcode";
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
  source: "serpapi";
  title: string;
  price: number;
  currency: string;
  url: string;
  imageUrl?: string;
  condition?: string;
  rating?: number;
  reviewCount?: number;
  /** The actual seller/storefront name from the underlying Google Shopping
   * result (e.g. "Nordstrom", "Poshmark", "eBay") — distinct from `source`
   * above, which identifies the data *provider* (always "serpapi" today) not
   * the merchant. Used server-side to split a single search's results into
   * retail vs. resale-marketplace subsets (see serpApiClient.ts's
   * RESALE_MARKETPLACE_DOMAINS) — kept on the type so the app can also show
   * "via Poshmark" style provenance if useful. Absent if SerpApi didn't
   * report one for this result. */
  merchant?: string;
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
  /** Aggregated from the subset of Google Shopping listings (via SerpApi) whose
   * merchant isn't a known resale marketplace — see estimatedResaleRange below.
   * Falls back to the full listing pool if that subset is empty (a search
   * dominated by resale-marketplace results shouldn't report no retail estimate
   * at all). Undefined when nothing was found. */
  estimatedNewRange?: PriceRange;
  /** Same query's results, but only the subset whose `merchant` (PriceListing)
   * matched a known resale marketplace (Poshmark, ThredUp, The RealReal, Depop,
   * eBay, Grailed — see serpApiClient.ts's RESALE_MARKETPLACE_DOMAINS). This
   * app previously had a resale-value signal via a dedicated eBay integration
   * that was removed entirely for being unreliably available (see git history);
   * this reintroduces one without a new vendor dependency, by recognizing
   * resale marketplaces that already show up mixed into ordinary Google
   * Shopping results. Undefined when too few resale-sourced listings turned up
   * to make a range meaningful (see priceSearch.ts's MIN_RESALE_SAMPLE) — this
   * is expected to be the common case for many searches, not a
   * bug; resale coverage varies a lot by category. */
  estimatedResaleRange?: PriceRange;
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

/** Response shape for POST /classify. Plural/array because one photo can now
 * report multiple distinct clothing items (see classifyImage in claudeClient.ts)
 * — an empty array means nothing recognizable and wearable was found, the same
 * "not a server error" outcome the old single-item UNRECOGNIZED_GARMENT sentinel
 * represented. GET /barcode-lookup stays single-item (`{ classification }`) since
 * a barcode match is always exactly one product — this type is /classify-only. */
export interface ClassifyResponseBody {
  classifications: ClassificationResult[];
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
 * describe the item to Claude for complementary-item suggestions. Includes `gender`
 * so suggested pairings (and the keyword phrases used to search for them) come back
 * correctly gendered rather than defaulting to ungendered/mixed results. */
export interface OutfitSuggestionsRequestBody {
  garmentType: string;
  category: string;
  color: string;
  pattern: string;
  style: string;
  gender: Gender;
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
  /** Optional ~160px JPEG data-URI thumbnail of the photo being corrected (see
   * compressForThumbnail in app/lib/compressImage.ts), threaded through from
   * CorrectionScreen. Persisted server-side alongside the correction (see
   * correctionLog.ts) purely for future review/eval-set curation — never
   * required, and absent just means the logged entry has no image. */
  photoThumbnail?: string;
}

export interface ApiErrorBody {
  error: string;
  reason?: string;
}
