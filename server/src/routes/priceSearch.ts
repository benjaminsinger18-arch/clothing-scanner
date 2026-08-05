import { Router } from "express";
import type { ApiErrorBody, BrandConfidence, PriceListing, PriceSearchResult } from "@clothing-scanner/shared-types";
import { searchEbay, type EbaySearchInput } from "../services/ebayClient.js";
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

  const input: EbaySearchInput & SerpApiSearchInput = {
    garmentType,
    category,
    color,
    brandGuess: typeof brandGuess === "string" && brandGuess.length > 0 ? brandGuess : null,
    brandConfidence:
      typeof brandConfidence === "string" && (VALID_BRAND_CONFIDENCE as string[]).includes(brandConfidence)
        ? (brandConfidence as BrandConfidence)
        : "none",
  };

  // Independent providers, queried in parallel — one failing (missing key, rate
  // limit, network error) never blocks the other's data from coming back.
  const [ebayResult, serpResult] = await Promise.all([searchEbay(input), searchSerpApi(input)]);

  // eBay's all-condition listings skew secondhand -> resale value.
  // eBay's new-condition listings + SerpApi's Google Shopping results are both
  // predominantly new/retail -> combined "new" price estimate.
  const newListings: PriceListing[] = [...ebayResult.newListings, ...serpResult.listings];
  const combinedSimilarItems: PriceListing[] = [...ebayResult.listings, ...serpResult.listings].sort(
    (a, b) => a.price - b.price
  );
  const reviews: PriceListing[] = serpResult.listings.filter((item) => typeof item.rating === "number");

  const result: PriceSearchResult = {
    status: combineStatus([ebayResult.status, serpResult.status], combinedSimilarItems.length),
    estimatedResaleRange: computePriceRange(ebayResult.listings),
    estimatedNewRange: computePriceRange(newListings),
    similarItems: combinedSimilarItems,
    reviews,
  };

  res.json(result);
});
