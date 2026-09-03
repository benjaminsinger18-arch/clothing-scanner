import Constants from "expo-constants";
import type {
  ClassificationResult,
  ClassifyRequestBody,
  CorrectionRequestBody,
  OutfitSuggestionsRequestBody,
  OutfitSuggestionsResult,
  PriceSearchResult,
} from "@clothing-scanner/shared-types";

// Read from app.config.js's `extra` (populated from EXPO_API_URL /
// EXPO_APP_SHARED_SECRET at build time) rather than process.env directly — Metro
// only auto-inlines EXPO_PUBLIC_-prefixed vars, and these intentionally aren't
// prefixed that way. See app.config.js for why this doesn't change what's exposed.
const API_URL = Constants.expoConfig?.extra?.apiUrl as string | null | undefined;
const APP_SHARED_SECRET = Constants.expoConfig?.extra?.appSharedSecret as string | null | undefined;

export class ApiError extends Error {
  reason?: string;
  constructor(message: string, reason?: string) {
    super(message);
    this.reason = reason;
  }
}

/** Auth header for the shared-secret check (server/src/lib/sharedSecretAuth.ts).
 * Harmless to send even when unset/not required — the server just ignores it. */
function authHeaders(): Record<string, string> {
  return APP_SHARED_SECRET ? { "X-App-Secret": APP_SHARED_SECRET } : {};
}

export async function classifyPhoto(imageBase64: string): Promise<ClassificationResult> {
  if (!API_URL) {
    throw new ApiError(
      "EXPO_API_URL is not set — copy app/.env.example to app/.env and point it at your backend"
    );
  }

  const body: ClassifyRequestBody = { imageBase64, mediaType: "image/jpeg" };

  let response: Response;
  try {
    response = await fetch(`${API_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "Could not reach the backend",
      `Check that the server is running and EXPO_API_URL (${API_URL}) is reachable from your phone`
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
      "EXPO_API_URL is not set — copy app/.env.example to app/.env and point it at your backend"
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
    response = await fetch(`${API_URL}/price-search?${params.toString()}`, { headers: authHeaders() });
  } catch {
    throw new ApiError(
      "Could not reach the backend",
      `Check that the server is running and EXPO_API_URL (${API_URL}) is reachable from your phone`
    );
  }

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(json?.error ?? "price_search_failed", json?.reason);
  }

  return json as PriceSearchResult;
}

export async function lookupBarcode(code: string): Promise<ClassificationResult> {
  if (!API_URL) {
    throw new ApiError(
      "EXPO_API_URL is not set — copy app/.env.example to app/.env and point it at your backend"
    );
  }

  const params = new URLSearchParams({ code });

  let response: Response;
  try {
    response = await fetch(`${API_URL}/barcode-lookup?${params.toString()}`, { headers: authHeaders() });
  } catch {
    throw new ApiError(
      "Could not reach the backend",
      `Check that the server is running and EXPO_API_URL (${API_URL}) is reachable from your phone`
    );
  }

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    // json?.error carries a specific code here — notably "not_found", which is a
    // common/expected outcome for clothing barcodes, not a generic failure.
    // BarcodeScanScreen branches on this to show a dedicated message.
    throw new ApiError(json?.error ?? "barcode_lookup_failed", json?.reason);
  }

  return json.classification as ClassificationResult;
}

export async function submitCorrection(
  correctionText: string,
  original: ClassificationResult
): Promise<ClassificationResult> {
  if (!API_URL) {
    throw new ApiError(
      "EXPO_API_URL is not set — copy app/.env.example to app/.env and point it at your backend"
    );
  }

  const body: CorrectionRequestBody = { correctionText, original };

  let response: Response;
  try {
    response = await fetch(`${API_URL}/correct-classification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "Could not reach the backend",
      `Check that the server is running and EXPO_API_URL (${API_URL}) is reachable from your phone`
    );
  }

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(json?.error ?? "correction_failed", json?.reason);
  }

  return json.classification as ClassificationResult;
}

export async function getOutfitSuggestions(classification: ClassificationResult): Promise<OutfitSuggestionsResult> {
  if (!API_URL) {
    throw new ApiError(
      "EXPO_API_URL is not set — copy app/.env.example to app/.env and point it at your backend"
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
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "Could not reach the backend",
      `Check that the server is running and EXPO_API_URL (${API_URL}) is reachable from your phone`
    );
  }

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(json?.error ?? "outfit_suggestions_failed", json?.reason);
  }

  return json as OutfitSuggestionsResult;
}
