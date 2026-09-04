import { Router } from "express";
import type {
  ApiErrorBody,
  BrandConfidence,
  OutfitSuggestion,
  OutfitSuggestionsRequestBody,
  OutfitSuggestionsResult,
} from "@clothing-scanner/shared-types";
import { suggestOutfitPairings } from "../services/claudeClient.js";
import { searchSerpApiByKeywords } from "../services/serpApiClient.js";
import { canMakeSerpApiOutfitCall, recordSerpApiOutfitCall } from "../lib/rateLimitTracker.js";

export const outfitSuggestionsRouter = Router();

const VALID_BRAND_CONFIDENCE: BrandConfidence[] = ["none", "low", "medium", "high"];

outfitSuggestionsRouter.post("/outfit-suggestions", async (req, res) => {
  const body = req.body as Partial<OutfitSuggestionsRequestBody>;

  if (!body.garmentType || !body.category || !body.color || !body.pattern || !body.style) {
    const errorBody: ApiErrorBody = {
      error: "invalid_request",
      reason: "garmentType, category, color, pattern, and style are required in the request body",
    };
    res.status(400).json(errorBody);
    return;
  }

  const brandConfidence: BrandConfidence =
    typeof body.brandConfidence === "string" && (VALID_BRAND_CONFIDENCE as string[]).includes(body.brandConfidence)
      ? body.brandConfidence
      : "none";

  let keywordsList: string[];
  try {
    keywordsList = await suggestOutfitPairings({
      garmentType: body.garmentType,
      category: body.category,
      color: body.color,
      pattern: body.pattern,
      style: body.style,
      brandGuess: body.brandGuess ?? null,
      brandConfidence,
    });
  } catch (err) {
    console.error("[/outfit-suggestions] Claude suggestion call failed:", err);
    const result: OutfitSuggestionsResult = { status: "unavailable", suggestions: [] };
    res.json(result);
    return;
  }

  if (keywordsList.length === 0) {
    const result: OutfitSuggestionsResult = { status: "no_results", suggestions: [] };
    res.json(result);
    return;
  }

  // Follow-up product search per suggested keyword combo, in parallel — one combo
  // failing/returning nothing doesn't drop the others. eBay used to be tried here
  // (with SerpApi as a capped fallback for just the first combo); eBay's been
  // removed from this app entirely, so SerpApi is now the only source. It's still
  // only used for the *first* combo, not all 3-5 — SerpApi's free tier is 250
  // searches/month, the tightest quota in the app and already spent on
  // /price-search's own comparison (~80-100 calls/month at this project's usage
  // estimate). Searching all 3-5 combos every scan would add 240-500 calls/month on
  // top of that, blowing through both the 220/month soft cap and the real 250/month
  // hard cap; capping to one combo adds ~80-100/month instead, keeping the combined
  // total (160-200/month) safely under both. See rateLimitTracker.ts's dedicated
  // SERPAPI_OUTFIT_MONTHLY_SOFT_CAP for the enforcement + arithmetic.
  const SERPAPI_OUTFIT_ELIGIBLE_SLOTS = 1;

  const suggestions: OutfitSuggestion[] = await Promise.all(
    keywordsList.map(async (keywords, index): Promise<OutfitSuggestion> => {
      if (index >= SERPAPI_OUTFIT_ELIGIBLE_SLOTS || !canMakeSerpApiOutfitCall()) {
        return { keywords, items: [] };
      }
      recordSerpApiOutfitCall();
      const serpApiResult = await searchSerpApiByKeywords(keywords, 4);
      return { keywords, items: serpApiResult.listings };
    })
  );

  const withItems = suggestions.filter((s) => s.items.length > 0);
  // Prefer only showing combos with purchasable items, but fall back to the full
  // (empty-item) list so the outfit ideas themselves still show even when nothing
  // was purchasable (expected for every combo past the first, per the cap above,
  // and possible for the first too if SerpApi itself is unavailable/rate-limited)
  // — better than a blank tab.
  const finalSuggestions = withItems.length > 0 ? withItems : suggestions;

  const result: OutfitSuggestionsResult = {
    status: withItems.length > 0 ? "ok" : "no_results",
    suggestions: finalSuggestions,
  };

  res.json(result);
});
