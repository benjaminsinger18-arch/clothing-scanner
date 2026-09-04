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

/** Hard ceiling on how far low/high are allowed to sit from the median,
 * applied as a final step in computePriceRange after the statistical trims
 * below. Those trims (outlier removal, then a percentile trim) still leave a
 * wide-looking range for a genuinely diverse category — a designer-brand
 * search across several real product tiers (canvas vs. exotic-leather belts,
 * say) has no statistical outlier and no gap for a percentile trim to lean
 * on, so the honest statistics still span most of the raw data. Capping
 * relative to the median guarantees a tight, predictable range regardless —
 * this intentionally overrides "statistically justified" width in favor of
 * "small gap, always," a product decision (not a stats one) made after the
 * two-layer trim alone still wasn't tight enough. 0.25 means low/high can
 * each sit at most 25% away from the median, so the full displayed range
 * never exceeds ~1.67x the low value (e.g. median $388 -> range capped to
 * roughly [$291, $485] regardless of how wide the underlying listings are). */
const MAX_RELATIVE_SPREAD = 0.25;

/** Aggregates a set of listings into a low/median/high summary — the "estimated
 * market value" proxy described in the plan (not an appraisal). Returns undefined
 * when there's nothing priced to summarize.
 *
 * Three-step narrowing, not a raw min/max — live-tested against real queries,
 * since each earlier step alone turned out insufficient on its own:
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
 *    genuine cross-model price diversity).
 * 3. Median-relative cap (MAX_RELATIVE_SPREAD above). Steps 1-2 are honest
 *    statistics, and for a genuinely diverse category they still produce a
 *    wide-looking range — not wrong, but wider than acceptable. This step
 *    forcibly clamps low/high to within MAX_RELATIVE_SPREAD of the median,
 *    guaranteeing a small, predictable gap for every category, statistically
 *    justified or not. Only ever narrows what steps 1-2 produced, never
 *    widens it.
 *
 * `similarItems`/`reviews` (built straight from the unfiltered listings
 * elsewhere) still show every listing including whatever got trimmed at any
 * step; only the summary low/high is affected — median is still the true
 * median of the outlier-cleaned set from step 1, not adjusted by step 3.
 * Step 1 needs at least 4 points for quartiles to mean anything; smaller
 * samples skip straight to step 2. If step 1 would eliminate every point (a
 * degenerate all-outliers case), it falls back to the untrimmed set rather
 * than showing nothing. */
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

  const median = medianOf(effective);

  const effectivePrices = effective.map((l) => l.price);
  const trimmedLow = percentile(effectivePrices, 0.1);
  const trimmedHigh = percentile(effectivePrices, 0.9);

  const low = Math.max(trimmedLow, median * (1 - MAX_RELATIVE_SPREAD));
  const high = Math.min(trimmedHigh, median * (1 + MAX_RELATIVE_SPREAD));

  return {
    low,
    high,
    median,
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
