// UPCitemdb integration — looks up a scanned barcode against their product
// database. Docs: https://www.upcitemdb.com/wp/docs/main/development/
//
// Uses the trial tier: no API key/signup needed at all (the one client in this
// codebase without a "not configured" branch), but its 100 requests/day quota is
// shared across every anonymous caller, not ours alone — see rateLimitTracker's
// UPC_DAILY_SOFT_CAP.
//
// Coverage note: general UPC databases have historically poor coverage for
// clothing specifically — lots of private-label/fast-fashion items were never
// registered. A "not_found" result is a common, expected outcome here, not a rare
// edge case — callers should treat it as such, not as a failure.

import { canMakeUpcCall, recordUpcCall } from "../lib/rateLimitTracker.js";
import { TtlCache } from "../lib/ttlCache.js";

const LOOKUP_URL = "https://api.upcitemdb.com/prod/trial/lookup";

// A UPC code's product record essentially never changes (unlike a price), and
// this quota is the tightest of any provider in the app — 100 req/day *shared
// across every anonymous trial user of UPCitemdb, not just this app's own
// traffic*. A popular item scanned by more than one tester/user within a week
// previously re-spent that shared quota on an identical lookup every time.
// A week-long TTL is safe here in a way it wouldn't be for price data.
const LOOKUP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const lookupCache = new TtlCache<UpcLookupResult>(LOOKUP_CACHE_TTL_MS);

export class UpcApiError extends Error {}

interface RawUpcItem {
  title?: string;
  brand?: string;
  color?: string;
  category?: string;
  description?: string;
}

interface RawUpcResponse {
  code?: string;
  message?: string;
  items?: RawUpcItem[];
}

export interface UpcItem {
  title: string;
  brand: string | null;
  color: string | null;
  /** Free-text, e.g. "Apparel > Men > Shirts" — UPCitemdb's own taxonomy, not this
   * app's controlled category enum. Passed to classifyFromBarcode as a hint for
   * mapping into that enum, never used directly. */
  category: string | null;
  description: string | null;
}

export type UpcLookupResult =
  | { status: "found"; item: UpcItem }
  | { status: "not_found" }
  | { status: "rate_limited" }
  | { status: "unavailable" };

// UPCitemdb sometimes returns a literal placeholder string instead of omitting a
// field entirely (observed live: brand: "N/A" on a match) — treat those the same
// as absent, or downstream code would confidently report "N/A" as a real brand.
const PLACEHOLDER_VALUES = new Set(["n/a", "na", "none", "unknown", "unbranded", "generic", ""]);
function cleanField(value: string | undefined): string | null {
  if (!value) return null;
  return PLACEHOLDER_VALUES.has(value.trim().toLowerCase()) ? null : value;
}

export async function lookupUpc(code: string): Promise<UpcLookupResult> {
  const cached = lookupCache.get(code);
  if (cached) return cached;

  const result = await lookupUpcUncached(code);
  // Same reasoning as serpApiClient.ts's cache: only pin genuine outcomes
  // ("found" or "not_found" are both real answers about this code), not
  // transient failure states — a rate-limited or unavailable result caching
  // for a week would turn a temporary blip into a week-long false negative.
  if (result.status === "found" || result.status === "not_found") {
    lookupCache.set(code, result);
  }
  return result;
}

async function lookupUpcUncached(code: string): Promise<UpcLookupResult> {
  if (!canMakeUpcCall()) {
    return { status: "rate_limited" };
  }

  const url = new URL(LOOKUP_URL);
  url.searchParams.set("upc", code);

  try {
    const response = await fetch(url);
    recordUpcCall();

    if (response.status === 429) {
      return { status: "rate_limited" };
    }
    if (!response.ok) {
      throw new UpcApiError(`UPCitemdb lookup failed: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as RawUpcResponse;
    // UPCitemdb signals "no usable match" a few different ways in practice (all
    // observed live, only NOT_FOUND is actually documented): an explicit
    // code:"NOT_FOUND"; code:"OK" with an empty items array; or code:"INVALID_UPC"
    // for a code that fails checksum validation. All three collapse to the same
    // outcome from the app's perspective — "couldn't find a product for this code,
    // try again or take a photo instead" — so there's no value in distinguishing
    // them further downstream.
    if (json.code === "NOT_FOUND" || json.code === "INVALID_UPC" || (json.code === "OK" && !json.items?.length)) {
      return { status: "not_found" };
    }
    if (json.code !== "OK" || !json.items?.length) {
      throw new UpcApiError(`UPCitemdb returned an unexpected response: ${json.code ?? "no code"}`);
    }

    const raw = json.items[0];
    if (!raw.title) {
      throw new UpcApiError("UPCitemdb match had no title");
    }

    return {
      status: "found",
      item: {
        title: raw.title,
        brand: cleanField(raw.brand),
        color: cleanField(raw.color),
        category: cleanField(raw.category),
        description: cleanField(raw.description),
      },
    };
  } catch (err) {
    console.error("[upcClient] lookup failed:", err);
    return { status: "unavailable" };
  }
}
