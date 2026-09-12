// Validation/normalization for images coming from the mobile app. The client is
// expected to have already resized/compressed the photo (~1024px, JPEG ~80%)
// before upload; this is a server-side safety net, not the primary resize step.

const MAX_BASE64_LENGTH = 8_000_000; // ~6MB decoded — generous ceiling for a compressed phone photo

// Standard base64 alphabet with optional padding — matches what every real
// base64 encoder (including expo-file-system's, which is what the app itself
// sends) produces. Not an RFC-strict validator, just enough to reject a
// garbage string before it's handed to Anthropic as if it were image bytes —
// previously the only check here was length, so any string under the size
// cap (a stray text field, a truncated upload, binary that isn't valid
// base64 at all) passed straight through and surfaced downstream as an
// opaque 502 from the classification call instead of a clear 400 here.
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export type SupportedMediaType = "image/jpeg" | "image/png" | "image/webp";

export class ImageValidationError extends Error {}

/** Strips an optional `data:image/jpeg;base64,` prefix, enforces a size
 * ceiling, and confirms the remainder is actually shaped like base64. */
export function validateImageBase64(imageBase64: unknown): string {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new ImageValidationError("imageBase64 is required and must be a string");
  }

  const stripped =
    imageBase64.startsWith("data:") && imageBase64.includes(",")
      ? imageBase64.slice(imageBase64.indexOf(",") + 1)
      : imageBase64;

  if (stripped.length === 0) {
    throw new ImageValidationError("imageBase64 must not be empty");
  }
  if (stripped.length > MAX_BASE64_LENGTH) {
    throw new ImageValidationError("Image is too large — please compress before uploading");
  }
  if (stripped.length % 4 !== 0 || !BASE64_PATTERN.test(stripped)) {
    throw new ImageValidationError("imageBase64 is not valid base64");
  }

  return stripped;
}

/** Defaults to JPEG only when `provided` is genuinely absent (the app itself
 * always sends "image/jpeg" explicitly — see app/services/api.ts — since its
 * own compression step always outputs JPEG; an omitted field just means an
 * older/alternate client, and JPEG remains the reasonable default for that
 * case). A *present but unrecognized* value used to silently coerce to
 * "image/jpeg" too, the same as an omitted one — meaning PNG/WEBP bytes sent
 * with a typo'd or unexpected mediaType value would get mislabeled and
 * handed to Anthropic as JPEG, surfacing as a confusing downstream failure
 * instead of a clear rejection here. Now only an actually-absent value
 * defaults; anything present-but-unrecognized is rejected outright. */
export function inferMediaType(provided: unknown): SupportedMediaType {
  if (provided === undefined) {
    return "image/jpeg";
  }
  if (provided === "image/jpeg" || provided === "image/png" || provided === "image/webp") {
    return provided;
  }
  throw new ImageValidationError(`Unsupported mediaType: ${typeof provided === "string" ? provided : typeof provided}`);
}
