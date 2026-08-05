import type {
  ClassificationResult,
  ClassifyRequestBody,
  OutfitSuggestionsRequestBody,
  OutfitSuggestionsResult,
  PriceSearchResult,
} from "@clothing-scanner/shared-types";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export class ApiError extends Error {
  reason?: string;
  constructor(message: string, reason?: string) {
    super(message);
    this.reason = reason;
  }
}

export async function classifyPhoto(imageBase64: string): Promise<ClassificationResult> {
  if (!API_URL) {
    throw new ApiError(
      "EXPO_PUBLIC_API_URL is not set — copy app/.env.example to app/.env and point it at your backend"
    );
  }

  const body: ClassifyRequestBody = { imageBase64, mediaType: "image/jpeg" };

  let response: Response;
  try {
    response = await fetch(`${API_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "Could not reach the backend",
      `Check that the server is running and EXPO_PUBLIC_API_URL (${API_URL}) is reachable from your phone`
    );
  }

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(json?.error ?? "classification_failed", json?.reason);
  }

  return json.classification as ClassificationResult;
}

export async function searchPrices(classification: ClassificationResult): Promise<PriceSearchResult> {
  if (!API_URL) {
    throw new ApiError(
      "EXPO_PUBLIC_API_URL is not set — copy app/.env.example to app/.env and point it at your backend"
    );
  }

  const params = new URLSearchParams({
    garmentType: classification.garmentType,
    category: classification.category,
    color: classification.color,
    brandConfidence: classification.brandConfidence,
  });
  if (classification.brandGuess) {
    params.set("brandGuess", classification.brandGuess);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/price-search?${params.toString()}`);
  } catch {
    throw new ApiError(
      "Could not reach the backend",
      `Check that the server is running and EXPO_PUBLIC_API_URL (${API_URL}) is reachable from your phone`
    );
  }

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(json?.error ?? "price_search_failed", json?.reason);
  }

  return json as PriceSearchResult;
}

export async function getOutfitSuggestions(classification: ClassificationResult): Promise<OutfitSuggestionsResult> {
  if (!API_URL) {
    throw new ApiError(
      "EXPO_PUBLIC_API_URL is not set — copy app/.env.example to app/.env and point it at your backend"
    );
  }

  const body: OutfitSuggestionsRequestBody = {
    garmentType: classification.garmentType,
    category: classification.category,
    color: classification.color,
    pattern: classification.pattern,
    style: classification.style,
    brandGuess: classification.brandGuess,
    brandConfidence: classification.brandConfidence,
  };

  let response: Response;
  try {
    response = await fetch(`${API_URL}/outfit-suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "Could not reach the backend",
      `Check that the server is running and EXPO_PUBLIC_API_URL (${API_URL}) is reachable from your phone`
    );
  }

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(json?.error ?? "outfit_suggestions_failed", json?.reason);
  }

  return json as OutfitSuggestionsResult;
}
