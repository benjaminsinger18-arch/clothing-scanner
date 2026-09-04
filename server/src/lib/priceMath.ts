import type { DataSourceStatus, PriceListing } from "@clothing-scanner/shared-types";

/** Linear-interpolation percentile (the common/"numpy default" method) over an
 * already-sorted array of numbers. */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 1) return sortedValues[0];
  const index = p * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function medianOf(sortedListings: PriceListing[]): number {
  const mid = Math.floor(sortedListings.length / 2);
  return sortedListings.length % 2 === 0
    ? (sortedListings[mid - 1].price + sortedListings[mid].price) / 2
    : sortedListings[mid].price;
}

/** Aggregates a set of listings into a low/median/high summary — the "estimated
 * market value" proxy described in the plan (not an appraisal). Returns undefined
 * when there's nothing priced to summarize.
 *
 * Two-layer trim, not a raw min/max — live-tested against real queries, since
 * one layer alone turned out insufficient:
 *
 * 1. Gap-based outlier removal (standard IQR/Tukey fence method: exclude
 *    anything outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR]). Catches a search that's
 *    mostly one tight cluster plus one or a few listings from a brand's
 *    premium/heritage/reissue line under the same name (e.g. a $60-80 cluster
 *    of regular trucker jackets alongside a $400+ "Vintage 1936 Type" reissue
 *    of the same jacket) — genuinely real, correctly-matched listings, not bad
 *    data, but a clear break from the main cluster. Does nothing when there's
 *    no such break.
 * 2. Percentile trim (10th-90th) of whatever survives step 1. Needed because
 *    some categories have no clean break at all — e.g. "Gucci belt" search
 *    results smoothly span ~$100 canvas belts to ~$900+ exotic-leather ones,
 *    12 different real models with no gap between them, which step 1 alone
 *    can't and shouldn't touch (there's no statistical outlier to find; it's
 *    genuine cross-model price diversity). This step trims the tails of
 *    *any* distribution, clean or not, so a smoothly wide spread still gets
 *    reported as a tighter, more typical band instead of its full extremes.
 *    Left mild (10/90, not something like 25/75) so it doesn't meaningfully
 *    narrow an already-clean cluster's own natural bounds after step 1.
 *
 * A genuinely diverse category (many product tiers under one brand) will
 * still show a wider range than a commodity item after both steps — that's
 * the market, not a bug, and narrowing it further would misrepresent it.
 * `similarItems`/`reviews` (built straight from the unfiltered listings
 * elsewhere) still show every listing including the trimmed extremes; only
 * the summary low/high/median is affected. Step 1 needs at least 4 points for
 * quartiles to mean anything; smaller samples skip straight to step 2 (which
 * itself is a no-op below 3 points, `percentile` on a 1-2 point array just
 * returns an endpoint). If step 1 would eliminate every point (a degenerate
 * all-outliers case), it falls back to the untrimmed set rather than showing
 * nothing. */
export function computePriceRange(
  listings: PriceListing[]
): { low: number; median: number; high: number; currency: string } | undefined {
  const priced = listings.filter((l) => l.price > 0);
  if (priced.length === 0) return undefined;

  const sorted = [...priced].sort((a, b) => a.price - b.price);

  let effective = sorted;
  if (sorted.length >= 4) {
    const prices = sorted.map((l) => l.price);
    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const withinFences = sorted.filter((l) => l.price >= lowerFence && l.price <= upperFence);
    if (withinFences.length > 0) {
      effective = withinFences;
    }
  }

  const effectivePrices = effective.map((l) => l.price);
  const low = percentile(effectivePrices, 0.1);
  const high = percentile(effectivePrices, 0.9);

  return {
    low,
    high,
    median: medianOf(effective),
    currency: sorted[0].currency,
  };
}

/** Reduces one or more providers' individual statuses into one overall status for
 * the response. Any actual data found beats an individual provider's failure — a
 * partial result is still useful — so status only reports trouble when there's
 * truly nothing to show. Still takes an array (not a single status) even though
 * SerpApi is the only price/listing provider left, so a second one could be added
 * later without reshaping this function. */
export function combineStatus(statuses: DataSourceStatus[], totalListings: number): DataSourceStatus {
  if (totalListings > 0) return "ok";
  if (statuses.length > 0 && statuses.every((s) => s === "rate_limited")) return "rate_limited";
  if (statuses.length > 0 && statuses.every((s) => s === "unavailable")) return "unavailable";
  if (statuses.some((s) => s === "rate_limited")) return "rate_limited";
  return "no_results";
}
