// SerpApi Google Shopping integration — cross-retailer price comparison plus
// whatever rating/review-count data Google Shopping bundles per listing.
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

export async function searchSerpApi(input: SerpApiSearchInput): Promise<SerpApiSearchResult> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    // Not configured yet — degrade quietly rather than throwing, same as ebayClient
    // does for missing credentials, so /price-search still returns whatever eBay has.
    return { status: "unavailable", listings: [] };
  }
  if (!canMakeSerpApiCall()) {
    return { status: "rate_limited", listings: [] };
  }

  const url = new URL(SEARCH_URL);
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", buildQuery(input));
  url.searchParams.set("gl", "us");
  url.searchParams.set("hl", "en");
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
      .slice(0, 12)
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
