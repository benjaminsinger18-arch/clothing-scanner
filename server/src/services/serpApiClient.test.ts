// Unit tests for isResaleListing — the resale-vs-retail domain-heuristic split
// priceSearch.ts uses to build estimatedResaleRange separately from
// estimatedNewRange (see that route's own comments on why: a resale listing
// mixed into the retail pool would otherwise drag the "new" estimate down).

import { describe, expect, it } from "vitest";
import type { PriceListing } from "@clothing-scanner/shared-types";
import { isResaleListing } from "./serpApiClient.js";

function listing(merchant: string | undefined): PriceListing {
  return { source: "serpapi", title: "test item", price: 50, currency: "USD", url: "https://example.com", merchant };
}

describe("isResaleListing", () => {
  it("returns false when there's no merchant at all", () => {
    expect(isResaleListing(listing(undefined))).toBe(false);
  });

  it.each(["Poshmark", "ThredUp", "The RealReal", "Depop", "eBay", "Grailed", "Vestiaire Collective"])(
    "recognizes %s as a resale marketplace",
    (merchant) => {
      expect(isResaleListing(listing(merchant))).toBe(true);
    }
  );

  it("matches case-insensitively", () => {
    expect(isResaleListing(listing("POSHMARK"))).toBe(true);
    expect(isResaleListing(listing("ebay"))).toBe(true);
  });

  it("matches a resale name embedded in a longer merchant string (substring match)", () => {
    expect(isResaleListing(listing("eBay Store: VintageFinds"))).toBe(true);
  });

  it("returns false for an ordinary retail merchant", () => {
    expect(isResaleListing(listing("Nordstrom"))).toBe(false);
    expect(isResaleListing(listing("Zappos"))).toBe(false);
  });

  it("does not false-positive on a merchant name that happens to share a short substring", () => {
    // Guards against an overly broad match — "Depop" shouldn't match unless
    // it's genuinely present as a substring.
    expect(isResaleListing(listing("Department Store Co"))).toBe(false);
  });
});
