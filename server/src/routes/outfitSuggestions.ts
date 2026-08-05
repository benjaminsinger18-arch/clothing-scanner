import { Router } from "express";
import type {
  ApiErrorBody,
  BrandConfidence,
  OutfitSuggestion,
  OutfitSuggestionsRequestBody,
  OutfitSuggestionsResult,
} from "@clothing-scanner/shared-types";
import { suggestOutfitPairings } from "../services/claudeClient.js";
import { searchEbayByKeywords } from "../services/ebayClient.js";

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
  // failing/returning nothing doesn't drop the others. eBay only here (not SerpApi):
  // SerpApi's free tier is 250 searches/month, the tightest quota in the stack, and
  // it's already spent on /price-search's cross-retailer comparison; spending several
  // more calls per scan on outfit combos would blow through that budget fast.
  const suggestions: OutfitSuggestion[] = await Promise.all(
    keywordsList.map(async (keywords): Promise<OutfitSuggestion> => {
      const ebayResult = await searchEbayByKeywords(keywords, 4);
      return { keywords, items: ebayResult.listings };
    })
  );

  const withItems = suggestions.filter((s) => s.items.length > 0);
  // Prefer only showing combos with purchasable items, but fall back to the full
  // (empty-item) list so the outfit ideas themselves still show if eBay came up dry
  // for all of them (e.g. rate-limited) — better than a blank tab.
  const finalSuggestions = withItems.length > 0 ? withItems : suggestions;

  const result: OutfitSuggestionsResult = {
    status: withItems.length > 0 ? "ok" : "no_results",
    suggestions: finalSuggestions,
  };

  res.json(result);
});
