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

const LOOKUP_URL = "https://api.upcitemdb.com/prod/trial/lookup";

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
