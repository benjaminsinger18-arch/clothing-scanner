import { Router } from "express";
import type { ApiErrorBody, BrandConfidence, PriceSearchResult } from "@clothing-scanner/shared-types";
import { searchSerpApi, type SerpApiSearchInput } from "../services/serpApiClient.js";
import { combineStatus, computePriceRange } from "../lib/priceMath.js";

export const priceSearchRouter = Router();

const VALID_BRAND_CONFIDENCE: BrandConfidence[] = ["none", "low", "medium", "high"];

// searchSerpApi now returns a much larger pool than what's ever shown (see its
// doc comment in serpApiClient.ts) specifically so similarItems/reviews below
// aren't drawing from the same artificially tiny, pre-truncated set. This is
// just the display cap for similarItems — estimatedNewRange and reviews below
// are computed from the full pool, not this slice.
const SIMILAR_ITEMS_DISPLAY_LIMIT = 12;
const REVIEWS_DISPLAY_LIMIT = 12;

priceSearchRouter.get("/price-search", async (req, res) => {
  const { garmentType, category, color, brandGuess, brandConfidence } = req.query;

  if (typeof garmentType !== "string" || typeof category !== "string" || typeof color !== "string") {
    const errorBody: ApiErrorBody = {
      error: "invalid_request",
      reason: "garmentType, category, and color query params are required",
    };
    res.status(400).json(errorBody);
    return;
  }

  const input: SerpApiSearchInput = {
    garmentType,
    category,
    color,
    brandGuess: typeof brandGuess === "string" && brandGuess.length > 0 ? brandGuess : null,
    brandConfidence:
      typeof brandConfidence === "string" && (VALID_BRAND_CONFIDENCE as string[]).includes(brandConfidence)
        ? (brandConfidence as BrandConfidence)
        : "none",
  };

  // eBay used to run alongside SerpApi here (parallel providers, one failing never
  // blocked the other), giving a resale-value estimate (from eBay's all-condition
  // listings) alongside a retail estimate. eBay's been removed from this app
  // entirely — it was unreliably available — so SerpApi (Google Shopping) is now
  // the sole source: a retail/new-item price estimate only, no resale counterpart,
  // since Google Shopping listings can't support one.
  const serpResult = await searchSerpApi(input);

  // Sourced from the FULL pool, not the similarItems slice below — this is the
  // actual fix for reviews availability varying wildly scan to scan (see
  // searchSerpApi's doc comment). Sorted so the most socially-validated
  // listings (most reviews, ties broken by rating) surface first, since a
  // bigger pool can now realistically return more rated listings than fit on
  // screen.
  const reviews = serpResult.listings
    .filter((item) => typeof item.rating === "number")
    .sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0) || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, REVIEWS_DISPLAY_LIMIT);

  const result: PriceSearchResult = {
    status: combineStatus([serpResult.status], serpResult.listings.length),
    // Computed from the full pool too — a bigger sample makes computePriceRange's
    // outlier/percentile/median-cap statistics more robust, not just a reviews fix.
    estimatedNewRange: computePriceRange(serpResult.listings),
    similarItems: serpResult.listings.slice(0, SIMILAR_ITEMS_DISPLAY_LIMIT),
    reviews,
  };

  res.json(result);
});
