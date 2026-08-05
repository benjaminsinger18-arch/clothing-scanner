// eBay Browse API integration — OAuth2 client-credentials grant + item search.
// Docs: https://developer.ebay.com/api-docs/buy/browse/overview.html
// Requires production keys (a sandbox keyset returns fake catalog data, not real listings).

import type { BrandConfidence, DataSourceStatus, PriceListing } from "@clothing-scanner/shared-types";
import { canMakeEbayCall, recordEbayCall } from "../lib/rateLimitTracker.js";

const OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

export class EbayError extends Error {}
export class EbayRateLimitError extends EbayError {}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let cachedToken: CachedToken | null = null;

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new EbayError(
      "EBAY_CLIENT_ID/EBAY_CLIENT_SECRET are not set — copy server/.env.example to server/.env and fill them in"
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }).toString(),
  });

  if (!response.ok) {
    throw new EbayError(`eBay OAuth token request failed: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.accessToken;
}

interface RawEbayItem {
  title: string;
  price?: { value: string; currency: string };
  itemWebUrl: string;
  image?: { imageUrl: string };
  condition?: string;
}

async function searchOnce(query: string, tokenRetried = false): Promise<PriceListing[]> {
  const token = await getAccessToken();
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "12");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });

  recordEbayCall();

  if (response.status === 401 && !tokenRetried) {
    await getAccessToken(true); // token likely expired/invalid — force a fresh one and retry once
    return searchOnce(query, true);
  }
  if (response.status === 429) {
    throw new EbayRateLimitError("eBay rate limit hit");
  }
  if (!response.ok) {
    throw new EbayError(`eBay search failed: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { itemSummaries?: RawEbayItem[] };
  return (json.itemSummaries ?? []).map((item) => ({
    source: "ebay" as const,
    title: item.title,
    price: item.price ? Number(item.price.value) : 0,
    currency: item.price?.currency ?? "USD",
    url: item.itemWebUrl,
    imageUrl: item.image?.imageUrl,
    condition: item.condition,
  }));
}

export interface EbaySearchInput {
  garmentType: string;
  category: string;
  color: string;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}

function buildQuery(input: EbaySearchInput): string {
  const parts: string[] = [];
  if (input.brandGuess && (input.brandConfidence === "medium" || input.brandConfidence === "high")) {
    parts.push(input.brandGuess);
  }
  parts.push(input.color, input.garmentType);
  return parts.filter(Boolean).join(" ");
}

function buildWidenedQuery(input: EbaySearchInput): string {
  // Drop brand/color filters — just category + garment type — for the no-results retry.
  return [input.category, input.garmentType].filter(Boolean).join(" ");
}

export interface EbaySearchResult {
  status: DataSourceStatus;
  listings: PriceListing[];
}

export async function searchEbay(input: EbaySearchInput): Promise<EbaySearchResult> {
  if (!canMakeEbayCall()) {
    return { status: "rate_limited", listings: [] };
  }

  try {
    let listings = await searchOnce(buildQuery(input));

    if (listings.length === 0) {
      if (!canMakeEbayCall()) {
        return { status: "rate_limited", listings: [] };
      }
      listings = await searchOnce(buildWidenedQuery(input));
    }

    return { status: listings.length > 0 ? "ok" : "no_results", listings };
  } catch (err) {
    if (err instanceof EbayRateLimitError) {
      return { status: "rate_limited", listings: [] };
    }
    console.error("[ebayClient] search failed:", err);
    return { status: "unavailable", listings: [] };
  }
}
