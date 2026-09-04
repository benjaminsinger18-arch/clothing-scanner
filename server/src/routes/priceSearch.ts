import { Router } from "express";
import type { ApiErrorBody, BrandConfidence, PriceSearchResult } from "@clothing-scanner/shared-types";
import { searchSerpApi, type SerpApiSearchInput } from "../services/serpApiClient.js";
import { combineStatus, computePriceRange } from "../lib/priceMath.js";

export const priceSearchRouter = Router();

const VALID_BRAND_CONFIDENCE: BrandConfidence[] = ["none", "low", "medium", "high"];

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

  const reviews = serpResult.listings.filter((item) => typeof item.rating === "number");

  const result: PriceSearchResult = {
    status: combineStatus([serpResult.status], serpResult.listings.length),
    estimatedNewRange: computePriceRange(serpResult.listings),
    similarItems: serpResult.listings,
    reviews,
  };

  res.json(result);
});
