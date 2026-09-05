import { Router } from "express";
import type { ApiErrorBody, ClassifyRequestBody } from "@clothing-scanner/shared-types";
import { classifyImage, ClassificationError } from "../services/claudeClient.js";
import { ImageValidationError, inferMediaType, validateImageBase64 } from "../lib/imageUtils.js";
import { logClassification } from "../lib/classificationLog.js";

export const classifyRouter = Router();

classifyRouter.post("/classify", async (req, res) => {
  const body = req.body as Partial<ClassifyRequestBody>;

  let imageBase64: string;
  try {
    imageBase64 = validateImageBase64(body.imageBase64);
  } catch (err) {
    const message = err instanceof ImageValidationError ? err.message : "Invalid image";
    const errorBody: ApiErrorBody = { error: "invalid_image", reason: message };
    res.status(400).json(errorBody);
    return;
  }

  const mediaType = inferMediaType(body.mediaType);

  try {
    const classification = await classifyImage({ imageBase64, mediaType });
    try {
      logClassification({ timestamp: new Date().toISOString(), trigger: "classify", result: classification });
    } catch (err) {
      console.warn("[/classify] Failed to log classification:", err);
    }
    res.json({ classification });
  } catch (err) {
    console.error("[/classify] classification failed:", err);
    const reason = err instanceof ClassificationError ? err.message : "Unknown error contacting Claude";
    const errorBody: ApiErrorBody = { error: "classification_failed", reason };
    res.status(502).json(errorBody);
  }
});
