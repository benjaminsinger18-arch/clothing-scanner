// SerpApi Google Shopping integration — the sole price/listing data source in this
// app (eBay was removed entirely; it was unreliably available). Powers /price-search
// (structured query from classification fields) and, capped, the first suggestion
// of /outfit-suggestions (plain keyword query) — see searchSerpApi vs
// searchSerpApiByKeywords below.
// Docs: https://serpapi.com/shopping-results
// Free tier: 250 searches/month (see rateLimitTracker's SERPAPI_MONTHLY_SOFT_CAP).

import type { BrandConfidence, DataSourceStatus, PriceListing } from "@clothing-scanner/shared-types";
import { canMakeSerpApiCall, recordSerpApiCall } from "../lib/rateLimitTracker.js";

const SEARCH_URL = "https://serpapi.com/search.json";

export class SerpApiError extends Error {}
export class SerpApiRateLimitError extends SerpApiError {}

interface RawShoppingResult {
  title: string;
  source?: string;
  link?: string;
  product_link?: string;
  thumbnail?: string;
  price?: string;
  extracted_price?: number;
  rating?: number;
  reviews?: number;
  condition?: string;
}

export interface SerpApiSearchInput {
  garmentType: string;
  category: string;
  color: string;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}

function buildQuery(input: SerpApiSearchInput): string {
  const parts: string[] = [];
  if (input.brandGuess && (input.brandConfidence === "medium" || input.brandConfidence === "high")) {
    parts.push(input.brandGuess);
  }
  parts.push(input.color, input.garmentType);
  return parts.filter(Boolean).join(" ");
}

export interface SerpApiSearchResult {
  status: DataSourceStatus;
  listings: PriceListing[];
}

/** `num` is how many raw results to request from SerpApi — NOT a display cap.
 * Callers get back the full filtered set (up to `num`); deciding how much of
 * it to actually show is the caller's job (see priceSearch.ts, which shows a
 * 12-item slice but computes stats/reviews from the whole pool). Quota is
 * metered per call (see recordSerpApiCall below), not per result count, so a
 * larger `num` doesn't cost more against SERPAPI_MONTHLY_SOFT_CAP — confirmed
 * live, not assumed (see the comment on searchSerpApi's `num` value). */
async function runSearch(query: string, num: number): Promise<SerpApiSearchResult> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    // Not configured yet — degrade quietly rather than throwing, so callers get a
    // clean "unavailable" status instead of an unhandled exception.
    return { status: "unavailable", listings: [] };
  }
  if (!canMakeSerpApiCall()) {
    return { status: "rate_limited", listings: [] };
  }

  const url = new URL(SEARCH_URL);
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", query);
  url.searchParams.set("gl", "us");
  url.searchParams.set("hl", "en");
  url.searchParams.set("num", String(num));
  url.searchParams.set("api_key", apiKey);

  try {
    const response = await fetch(url);
    recordSerpApiCall();

    if (response.status === 429) {
      throw new SerpApiRateLimitError("SerpApi rate limit hit");
    }
    if (!response.ok) {
      throw new SerpApiError(`SerpApi search failed: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as { shopping_results?: RawShoppingResult[]; error?: string };
    if (json.error) {
      throw new SerpApiError(`SerpApi returned an error: ${json.error}`);
    }

    const listings: PriceListing[] = (json.shopping_results ?? [])
      .filter((item): item is RawShoppingResult & { extracted_price: number } => typeof item.extracted_price === "number")
      // Defensive cap in case SerpApi ever returns more than requested — not a
      // display-truncation step (see this function's doc comment above).
      .slice(0, num)
      .map((item) => ({
        source: "serpapi" as const,
        title: item.title,
        price: item.extracted_price,
        currency: "USD",
        url: item.product_link ?? item.link ?? "",
        imageUrl: item.thumbnail,
        condition: item.condition,
        rating: item.rating,
        reviewCount: item.reviews,
      }));

    return { status: listings.length > 0 ? "ok" : "no_results", listings };
  } catch (err) {
    if (err instanceof SerpApiRateLimitError) {
      return { status: "rate_limited", listings: [] };
    }
    console.error("[serpApiClient] search failed:", err);
    return { status: "unavailable", listings: [] };
  }
}

/** Requests a much larger pool than what's ever displayed (12 items in
 * similarItems — see priceSearch.ts) specifically so the Reviews tab has
 * more than a handful of listings to find a `rating` in. Google Shopping
 * doesn't guarantee a rating on every result, so filtering an already-tiny
 * pool (the old behavior: 12 requested, 12 kept) meant whether any ratings
 * survived the filter was mostly luck — that was the actual root cause of
 * "reviews availability varies wildly" reports, not a filtering bug. 40 is a
 * deliberately large ask; SerpApi may return fewer if the query itself has
 * few matches, which is fine — this is a request ceiling, not a promise. */
export async function searchSerpApi(input: SerpApiSearchInput): Promise<SerpApiSearchResult> {
  return runSearch(buildQuery(input), 40);
}

export interface SimpleSerpApiSearchResult {
  status: DataSourceStatus;
  listings: PriceListing[];
}

/** Direct keyword search, no structured-input query building — used by
 * server/src/routes/outfitSuggestions.ts, where the input is already a
 * search-ready phrase (e.g. "navy chino pants") rather than classification
 * fields. Only ever called for a single, capped slot per request — see the
 * caller for why (protecting /price-search's share of the shared SerpApi
 * quota). */
export async function searchSerpApiByKeywords(query: string, limit = 4): Promise<SimpleSerpApiSearchResult> {
  return runSearch(query, limit);
}
