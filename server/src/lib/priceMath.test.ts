// Unit tests for computePriceRange's three-step narrowing (IQR outlier removal
// -> percentile trim -> median-relative cap) and combineStatus's status
// reduction — see priceMath.ts's own doc comments for the reasoning behind
// each step; these tests exist to lock that behavior in against a future
// change, not to re-explain it.

import { describe, expect, it } from "vitest";
import type { PriceListing } from "@clothing-scanner/shared-types";
import { combineStatus, computePriceRange } from "./priceMath.js";

function listing(price: number, currency = "USD"): PriceListing {
  return {
    source: "serpapi",
    title: "test item",
    price,
    currency,
    url: "https://example.com",
    merchant: "Example Store",
  };
}

describe("computePriceRange", () => {
  it("returns undefined when there are no priced listings", () => {
    expect(computePriceRange([])).toBeUndefined();
    expect(computePriceRange([listing(0), listing(-5)])).toBeUndefined();
  });

  it("ignores unpriced (price <= 0) listings mixed in with priced ones", () => {
    const result = computePriceRange([listing(0), listing(50), listing(60), listing(70)]);
    expect(result).toBeDefined();
    expect(result!.median).toBe(60);
  });

  it("returns the single price as low/median/high for one listing", () => {
    const result = computePriceRange([listing(42)]);
    expect(result).toEqual({ low: 42, median: 42, high: 42, currency: "USD" });
  });

  it("takes currency from the (sorted) first listing", () => {
    const result = computePriceRange([listing(100, "EUR"), listing(50, "EUR")]);
    expect(result!.currency).toBe("EUR");
  });

  it("computes a plain median for a small, tight cluster with no outliers", () => {
    // Fewer than 4 points skips the IQR step entirely (see the function's own
    // comment) — straight to the 10th/90th percentile trim, which linearly
    // interpolates rather than snapping to min/max: for [48,50,52] that's
    // 48 + 0.2*(50-48) = 48.4 and 50 + 0.8*(52-50) = 51.6 (see percentile()'s
    // own doc comment — "the common/numpy default method").
    const result = computePriceRange([listing(48), listing(50), listing(52)]);
    expect(result!.median).toBe(50);
    expect(result!.low).toBeCloseTo(48.4, 5);
    expect(result!.high).toBeCloseTo(51.6, 5);
  });

  it("excludes a clear price-cluster break via the IQR fence (step 1)", () => {
    // A tight $60-80 cluster plus one $400 outlier — the exact "premium
    // reissue" scenario from this function's own doc comment. Needs >= 4
    // points for the IQR step to run at all.
    const listings = [listing(60), listing(65), listing(70), listing(75), listing(80), listing(400)];
    const result = computePriceRange(listings);
    expect(result).toBeDefined();
    // The $400 outlier should be fenced out of the median calculation —
    // median of the remaining 5-point cluster (60,65,70,75,80) is 70.
    expect(result!.median).toBe(70);
    expect(result!.high).toBeLessThan(400);
  });

  it("falls back to the untrimmed set if the IQR fence would exclude everything", () => {
    // Degenerate case: every point is equidistant in a way that could zero out
    // the fence — computePriceRange must never return undefined once there's
    // at least one priced listing.
    const listings = [listing(10), listing(10), listing(10), listing(10)];
    const result = computePriceRange(listings);
    expect(result).toBeDefined();
    expect(result!.median).toBe(10);
  });

  it("applies the median-relative cap (step 3) to a genuinely diverse category with no statistical outlier", () => {
    // The "Gucci belt" scenario from the doc comment: a smooth spread from
    // $100 to $900 with no gap for IQR or percentile trimming to find.
    const prices = [100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900];
    const listings = prices.map((p) => listing(p));
    const result = computePriceRange(listings)!;
    // Median-relative cap: low/high must sit within 25% of the median.
    expect(result.low).toBeGreaterThanOrEqual(result.median * 0.75 - 0.001);
    expect(result.high).toBeLessThanOrEqual(result.median * 1.25 + 0.001);
  });

  it("never lets the cap widen the range beyond what steps 1-2 already produced", () => {
    // A tight cluster where the percentile-trimmed range is already narrower
    // than the median-relative cap would allow — low/high should stay at the
    // tighter (trimmed) bound, not get pulled outward to the cap.
    const listings = [listing(98), listing(99), listing(100), listing(101), listing(102)];
    const result = computePriceRange(listings)!;
    expect(result.low).toBeGreaterThanOrEqual(98);
    expect(result.high).toBeLessThanOrEqual(102);
  });
});

describe("combineStatus", () => {
  it("returns ok whenever there are any listings, regardless of individual statuses", () => {
    expect(combineStatus(["rate_limited"], 5)).toBe("ok");
    expect(combineStatus(["unavailable", "ok"], 1)).toBe("ok");
  });

  it("returns rate_limited when every status is rate_limited and there are no listings", () => {
    expect(combineStatus(["rate_limited"], 0)).toBe("rate_limited");
    expect(combineStatus(["rate_limited", "rate_limited"], 0)).toBe("rate_limited");
  });

  it("returns unavailable when every status is unavailable and there are no listings", () => {
    expect(combineStatus(["unavailable"], 0)).toBe("unavailable");
  });

  it("prefers rate_limited over unavailable in a mixed-status, no-listings case", () => {
    expect(combineStatus(["unavailable", "rate_limited"], 0)).toBe("rate_limited");
  });

  it("returns no_results for an empty statuses array with no listings", () => {
    expect(combineStatus([], 0)).toBe("no_results");
  });

  it("returns no_results when every status is ok but there are somehow no listings", () => {
    expect(combineStatus(["ok"], 0)).toBe("no_results");
  });
});
