// Validation/normalization for images coming from the mobile app. The client is
// expected to have already resized/compressed the photo (~1024px, JPEG ~80%)
// before upload; this is a server-side safety net, not the primary resize step.

const MAX_BASE64_LENGTH = 8_000_000; // ~6MB decoded — generous ceiling for a compressed phone photo

export type SupportedMediaType = "image/jpeg" | "image/png" | "image/webp";

export class ImageValidationError extends Error {}

/** Strips an optional `data:image/jpeg;base64,` prefix and enforces a size ceiling. */
export function validateImageBase64(imageBase64: unknown): string {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new ImageValidationError("imageBase64 is required and must be a string");
  }

  const stripped = imageBase64.startsWith("data:") && imageBase64.includes(",")
    ? imageBase64.slice(imageBase64.indexOf(",") + 1)
    : imageBase64;

  if (stripped.length === 0) {
    throw new ImageValidationError("imageBase64 must not be empty");
  }
  if (stripped.length > MAX_BASE64_LENGTH) {
    throw new ImageValidationError("Image is too large — please compress before uploading");
  }

  return stripped;
}

export function inferMediaType(provided: unknown): SupportedMediaType {
  if (provided === "image/jpeg" || provided === "image/png" || provided === "image/webp") {
    return provided;
  }
  return "image/jpeg";
}
