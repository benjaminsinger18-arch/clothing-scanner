import "dotenv/config";
import cors from "cors";
import express from "express";
import { classifyRouter } from "./routes/classify.js";
import { outfitSuggestionsRouter } from "./routes/outfitSuggestions.js";
import { priceSearchRouter } from "./routes/priceSearch.js";
import { barcodeLookupRouter } from "./routes/barcodeLookup.js";
import { sharedSecretAuth } from "./lib/sharedSecretAuth.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" })); // base64 images inflate ~33% over raw bytes

// Unauthenticated: Render's own health check hits this with no headers, and it
// leaks nothing sensitive.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Everything below costs real money per request (Claude/eBay/SerpApi calls) —
// gate it behind the shared-secret check.
app.use(sharedSecretAuth);
app.use(classifyRouter);
app.use(priceSearchRouter);
app.use(outfitSuggestionsRouter);
app.use(barcodeLookupRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server] unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[server] ANTHROPIC_API_KEY is not set — /classify will fail until server/.env is configured.");
  }
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    console.warn("[server] EBAY_CLIENT_ID/EBAY_CLIENT_SECRET are not set — eBay data will be unavailable in /price-search.");
  }
  if (!process.env.SERPAPI_KEY) {
    console.warn("[server] SERPAPI_KEY is not set — SerpApi data (cross-retailer pricing, reviews) will be unavailable.");
  }
  if (!process.env.GOOGLE_VISION_API_KEY) {
    console.warn(
      "[server] GOOGLE_VISION_API_KEY is not set — /classify will run Claude (+ Gemini, if configured) alone, " +
        "with no logo-detection brand boost or Vision-hint rescue."
    );
  }
  if (!process.env.GEMINI_API_KEY) {
    console.warn(
      "[server] GEMINI_API_KEY is not set — /classify will run without Gemini's second opinion " +
        "(no brand cross-validation from it, no Gemini rescue pass)."
    );
  }
  if (!process.env.APP_SHARED_SECRET) {
    console.warn(
      "[server] APP_SHARED_SECRET is not set — all endpoints are open with no auth. " +
        "Fine for local dev; set this before/after deploying publicly to deter abuse."
    );
  }
});
