import { Router } from "express";
import type { ApiErrorBody, ClassifyRequestBody } from "@clothing-scanner/shared-types";
import { classifyImage, ClassificationConfigError, ClassificationError } from "../services/claudeClient.js";
import { ImageValidationError, inferMediaType, validateImageBase64 } from "../lib/imageUtils.js";
import { logClassification } from "../lib/classificationLog.js";

export const classifyRouter = Router();

classifyRouter.post("/classify", async (req, res) => {
  const body = req.body as Partial<ClassifyRequestBody>;

  let imageBase64: string;
  let mediaType: ReturnType<typeof inferMediaType>;
  try {
    imageBase64 = validateImageBase64(body.imageBase64);
    mediaType = inferMediaType(body.mediaType);
  } catch (err) {
    const message = err instanceof ImageValidationError ? err.message : "Invalid image";
    const errorBody: ApiErrorBody = { error: "invalid_image", reason: message };
    res.status(400).json(errorBody);
    return;
  }

  const startedAt = Date.now();
  try {
    const { classifications, usage } = await classifyImage({ imageBase64, mediaType });
    try {
      logClassification({
        timestamp: new Date().toISOString(),
        trigger: "classify",
        result: classifications,
        latencyMs: Date.now() - startedAt,
        usage,
      });
    } catch (err) {
      console.warn("[/classify] Failed to log classification:", err);
    }
    res.json({ classifications });
  } catch (err) {
    console.error("[/classify] classification failed:", err);
    // ClassificationConfigError's message is written for the server console
    // (setup instructions, env var names), not for a client holding the
    // shared secret — never forward it. Every other ClassificationError
    // describes what actually went wrong with this request/upstream call and
    // is fine to surface, same as before.
    const reason =
      err instanceof ClassificationConfigError
        ? "The server isn't configured correctly. Try again later."
        : err instanceof ClassificationError
          ? err.message
          : "Unknown error contacting Claude";
    const errorBody: ApiErrorBody = { error: "classification_failed", reason };
    res.status(502).json(errorBody);
  }
});
