import { Router } from "express";
import type { ApiErrorBody, BrandConfidence, PriceSearchResult } from "@clothing-scanner/shared-types";
import { searchEbay, type EbaySearchInput } from "../services/ebayClient.js";
import { computePriceRange } from "../lib/priceMath.js";

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

  const input: EbaySearchInput = {
    garmentType,
    category,
    color,
    brandGuess: typeof brandGuess === "string" && brandGuess.length > 0 ? brandGuess : null,
    brandConfidence:
      typeof brandConfidence === "string" && (VALID_BRAND_CONFIDENCE as string[]).includes(brandConfidence)
        ? (brandConfidence as BrandConfidence)
        : "none",
  };

  // Only one provider (eBay) exists as of Phase 2 — SerpApi joins in Phase 3 and this
  // result will merge both. `reviews` stays empty until then (eBay Browse API doesn't
  // reliably return review data).
  const ebayResult = await searchEbay(input);

  const result: PriceSearchResult = {
    status: ebayResult.status,
    estimatedResaleRange: computePriceRange(ebayResult.listings),
    estimatedNewRange: computePriceRange(ebayResult.newListings),
    similarItems: ebayResult.listings,
    reviews: [],
  };

  res.json(result);
});
