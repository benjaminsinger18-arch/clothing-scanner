// SerpApi Google Shopping integration — the sole price/listing data source in this
// app (eBay was removed entirely; it was unreliably available). Powers /price-search
// (structured query from classification fields) and, capped, the first suggestion
// of /outfit-suggestions (plain keyword query) — see searchSerpApi vs
// searchSerpApiByKeywords below.
// Docs: https://serpapi.com/shopping-results
// Free tier: 250 searches/month (see rateLimitTracker's SERPAPI_MONTHLY_SOFT_CAP).

import type { BrandConfidence, DataSourceStatus, PriceListing } from "@clothing-scanner/shared-types";
import { canMakeSerpApiCall, recordSerpApiCall } from "../lib/rateLimitTracker.js";
import { TtlCache } from "../lib/ttlCache.js";
import { applyAffiliateTag } from "../lib/affiliateLinks.js";

const SEARCH_URL = "https://serpapi.com/search.json";

// Two different users scanning the same popular item (or one user rescanning)
// produce the exact same query string, which previously always burned a fresh
// call against the tightest quota in the app (SerpApi's 250/month free tier).
// Retail prices don't move meaningfully within a few hours, so a short-lived
// cache keyed on the literal query+size trades a small amount of staleness for
// a real reduction in call volume. Deliberately short (not day/week-long) so
// price data doesn't go stale for long if a listing's price does move.
const SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const searchCache = new TtlCache<SerpApiSearchResult>(SEARCH_CACHE_TTL_MS);

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
  const cacheKey = `${query.trim().toLowerCase()}::${num}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const result = await runSearchUncached(query, num);
  // Only cache genuine outcomes, not transient failure states — caching a
  // rate-limited or unavailable result for hours would turn a temporary blip
  // into a multi-hour outage for every subsequent identical query, which
  // defeats the point of a short cache (avoiding wasted quota, not masking
  // real failures).
  if (result.status === "ok" || result.status === "no_results") {
    searchCache.set(cacheKey, result);
  }
  return result;
}

async function runSearchUncached(query: string, num: number): Promise<SerpApiSearchResult> {
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
        url: applyAffiliateTag(item.product_link ?? item.link ?? ""),
        imageUrl: item.thumbnail,
        condition: item.condition,
        rating: item.rating,
        reviewCount: item.reviews,
        merchant: item.source,
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

/** Small synonym table for garment-type head nouns whose real listing titles
 * commonly use a different word — e.g. a bag is almost never literally titled
 * "... Bag" alone, it's usually "... Tote"/"... Satchel"/"... Crossbody". Only
 * covers categories where this is common; anything else falls back to
 * requiring the literal head noun itself, which works fine for e.g. "jacket"
 * or "sweater" where real titles do use the word directly. Confirmed live
 * that SerpApi's raw response has no structured category field to check
 * instead (only title/source/price/rating/etc) — this is a best-effort
 * lexical heuristic, not a guarantee. It won't catch every mismatch (a
 * cross-category product whose title happens to use one of these synonym
 * words as a modifier rather than its actual type — e.g. a boot literally
 * titled "... Tote Boot" — will still slip through a "bag" search, since
 * "tote" genuinely appears in its title), but it does reliably exclude the
 * much more common case: a result sharing no real vocabulary with the
 * searched category at all. */
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  bag: ["tote", "purse", "handbag", "satchel", "hobo", "crossbody", "clutch"],
  "t-shirt": ["tee", "shirt"],
  tee: ["t-shirt", "shirt"],
  sneakers: ["shoes", "trainers"],
  shoes: ["sneakers", "trainers", "loafers", "boots"],
  sweater: ["jumper", "pullover", "cardigan"],
  jacket: ["coat"],
  pants: ["trousers", "jeans", "chinos"],
};

function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Drops listings whose title shares no real vocabulary with the searched
 * garment type — see CATEGORY_SYNONYMS' doc comment for the exact matching
 * approach and its known limits. Matches on garmentType's last word (its head
 * noun — "denim jacket" -> "jacket") rather than the whole phrase, since
 * modifiers like "denim"/"graphic"/"chino" routinely don't appear verbatim in
 * an otherwise-correct listing's title. Falls back to the unfiltered set if
 * this would eliminate everything, same defensive pattern computePriceRange
 * uses for its own outlier trimming — an unusual garmentType wording not
 * matching any title verbatim is more likely a false negative in this
 * heuristic than every single result genuinely being wrong-category. */
function filterToRelevantCategory(listings: PriceListing[], garmentType: string): PriceListing[] {
  const gtWords = garmentType.toLowerCase().split(/\s+/).filter(Boolean);
  const headNoun = gtWords[gtWords.length - 1];
  if (!headNoun) return listings;

  const candidates = new Set([headNoun, ...(CATEGORY_SYNONYMS[headNoun] ?? [])]);

  const relevant = listings.filter((item) => titleWords(item.title).some((w) => candidates.has(w)));
  return relevant.length > 0 ? relevant : listings;
}

/** Known resale/secondhand marketplaces, matched against a listing's
 * `merchant` field (the raw `source` SerpApi reports, e.g. "Poshmark",
 * "eBay") to split one search's results into retail vs. resale subsets — see
 * shared-types' PriceSearchResult.estimatedResaleRange doc comment for why
 * this exists. Google Shopping results are dominated by ordinary retailers,
 * but secondhand marketplaces do show up mixed in for plenty of categories
 * (especially anything with brand recognition — the resale market is exactly
 * where that matters most), so this needs no separate query or extra quota:
 * it's a partition of the same pool searchSerpApi already fetches. Matched
 * as a case-insensitive substring of the merchant name rather than an exact
 * match, since SerpApi's `source` string sometimes includes extra context
 * (e.g. "Poshmark - username" has been observed live). */
const RESALE_MARKETPLACES = ["poshmark", "thredup", "therealreal", "the realreal", "depop", "ebay", "grailed", "vestiaire"];

export function isResaleListing(listing: PriceListing): boolean {
  if (!listing.merchant) return false;
  const merchant = listing.merchant.toLowerCase();
  return RESALE_MARKETPLACES.some((name) => merchant.includes(name));
}

/** Requests a much larger pool than what's ever displayed (12 items in
 * similarItems — see priceSearch.ts) specifically so the Reviews tab has
 * more than a handful of listings to find a `rating` in. Google Shopping
 * doesn't guarantee a rating on every result, so filtering an already-tiny
 * pool (the old behavior: 12 requested, 12 kept) meant whether any ratings
 * survived the filter was mostly luck — that was the actual root cause of
 * "reviews availability varies wildly" reports, not a filtering bug. 40 is a
 * deliberately large ask; SerpApi may return fewer if the query itself has
 * few matches, which is fine — this is a request ceiling, not a promise.
 * Widening the pool this much surfaces a second problem, though — deeper
 * results drift further off-topic (Google's own relevance ranking degrades
 * past the first page), so the result is passed through
 * filterToRelevantCategory before being returned, applying once here so
 * similarItems/reviews/estimatedNewRange in priceSearch.ts all benefit,
 * not just whichever one a caller happens to be building. */
export async function searchSerpApi(input: SerpApiSearchInput): Promise<SerpApiSearchResult> {
  const result = await runSearch(buildQuery(input), 40);
  return { ...result, listings: filterToRelevantCategory(result.listings, input.garmentType) };
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
