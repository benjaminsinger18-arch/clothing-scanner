import type { DataSourceStatus, PriceListing } from "@clothing-scanner/shared-types";

/** Aggregates a set of listings into a low/median/high summary — the "estimated
 * market value" proxy described in the plan (not an appraisal). Returns undefined
 * when there's nothing priced to summarize. */
export function computePriceRange(
  listings: PriceListing[]
): { low: number; median: number; high: number; currency: string } | undefined {
  const priced = listings.filter((l) => l.price > 0);
  if (priced.length === 0) return undefined;

  const sorted = [...priced].sort((a, b) => a.price - b.price);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1].price + sorted[mid].price) / 2 : sorted[mid].price;

  return {
    low: sorted[0].price,
    high: sorted[sorted.length - 1].price,
    median,
    currency: sorted[0].currency,
  };
}

/** Reduces multiple providers' individual statuses (eBay, SerpApi, ...) into one
 * overall status for the response. Any actual data found beats an individual
 * provider's failure — a partial result is still useful — so status only reports
 * trouble when there's truly nothing to show. */
export function combineStatus(statuses: DataSourceStatus[], totalListings: number): DataSourceStatus {
  if (totalListings > 0) return "ok";
  if (statuses.length > 0 && statuses.every((s) => s === "rate_limited")) return "rate_limited";
  if (statuses.length > 0 && statuses.every((s) => s === "unavailable")) return "unavailable";
  if (statuses.some((s) => s === "rate_limited")) return "rate_limited";
  return "no_results";
}
