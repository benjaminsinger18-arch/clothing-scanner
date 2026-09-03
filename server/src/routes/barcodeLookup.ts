import { Router } from "express";
import type { ApiErrorBody } from "@clothing-scanner/shared-types";
import { lookupUpc } from "../services/upcClient.js";
import { classifyFromBarcode, ClassificationError } from "../services/claudeClient.js";

export const barcodeLookupRouter = Router();

// UPC-E/EAN-8 (8 digits), UPC-A (12), EAN-13 (13) — the standard retail barcode
// formats a phone camera can realistically scan off a clothing tag.
const CODE_RE = /^\d{8,13}$/;

barcodeLookupRouter.get("/barcode-lookup", async (req, res) => {
  const { code } = req.query;

  if (typeof code !== "string" || !CODE_RE.test(code)) {
    const errorBody: ApiErrorBody = {
      error: "invalid_request",
      reason: "code query param is required and must be an 8-13 digit UPC/EAN barcode",
    };
    res.status(400).json(errorBody);
    return;
  }

  const lookup = await lookupUpc(code);

  if (lookup.status === "not_found") {
    // Common, expected outcome for clothing specifically (see upcClient.ts) — not
    // a server error, but still a "no result" the app needs to branch on distinctly
    // from a generic failure, hence its own status code.
    const errorBody: ApiErrorBody = { error: "not_found", reason: "No product found for this barcode" };
    res.status(404).json(errorBody);
    return;
  }
  if (lookup.status === "rate_limited") {
    const errorBody: ApiErrorBody = { error: "rate_limited", reason: "Barcode lookup quota reached for today" };
    res.status(429).json(errorBody);
    return;
  }
  if (lookup.status === "unavailable") {
    const errorBody: ApiErrorBody = { error: "lookup_unavailable", reason: "Could not reach the barcode database" };
    res.status(502).json(errorBody);
    return;
  }

  try {
    const classification = await classifyFromBarcode(lookup.item);
    res.json({ classification });
  } catch (err) {
    console.error("[/barcode-lookup] normalization failed:", err);
    const reason = err instanceof ClassificationError ? err.message : "Unknown error normalizing the barcode match";
    const errorBody: ApiErrorBody = { error: "classification_failed", reason };
    res.status(502).json(errorBody);
  }
});
