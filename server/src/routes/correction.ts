import { Router } from "express";
import type { ApiErrorBody, ClassificationResult, CorrectionRequestBody } from "@clothing-scanner/shared-types";
import { verifyCorrection } from "../services/claudeClient.js";

export const correctionRouter = Router();

const MAX_CORRECTION_LENGTH = 500;

correctionRouter.post("/correct-classification", async (req, res) => {
  const body = req.body as Partial<CorrectionRequestBody>;
  const text = typeof body.correctionText === "string" ? body.correctionText.trim() : "";

  if (!text || text.length > MAX_CORRECTION_LENGTH) {
    const errorBody: ApiErrorBody = {
      error: "invalid_request",
      reason: `correctionText is required and must be under ${MAX_CORRECTION_LENGTH} characters`,
    };
    res.status(400).json(errorBody);
    return;
  }
  if (!body.original?.garmentType || !body.original?.category) {
    const errorBody: ApiErrorBody = {
      error: "invalid_request",
      reason: "original classification is required in the request body",
    };
    res.status(400).json(errorBody);
    return;
  }

  const result = await verifyCorrection(text, body.original as ClassificationResult);

  switch (result.status) {
    case "ok":
      res.json({ classification: result.classification });
      return;
    case "rate_limited": {
      const errorBody: ApiErrorBody = { error: "rate_limited", reason: "Correction verification quota reached for today" };
      res.status(429).json(errorBody);
      return;
    }
    case "research_unavailable": {
      const errorBody: ApiErrorBody = {
        error: "research_unavailable",
        reason: "Could not verify this correction via web search — try again",
      };
      res.status(502).json(errorBody);
      return;
    }
    case "structuring_failed": {
      const errorBody: ApiErrorBody = { error: "correction_failed", reason: result.reason };
      res.status(502).json(errorBody);
      return;
    }
  }
});
