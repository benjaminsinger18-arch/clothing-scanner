import "dotenv/config";
import cors from "cors";
import express from "express";
import { classifyRouter } from "./routes/classify.js";
import { outfitSuggestionsRouter } from "./routes/outfitSuggestions.js";
import { priceSearchRouter } from "./routes/priceSearch.js";
import { barcodeLookupRouter } from "./routes/barcodeLookup.js";
import { correctionRouter } from "./routes/correction.js";
import { sharedSecretAuth } from "./lib/sharedSecretAuth.js";
import { restoreFromBucket, isBucketSyncConfigured } from "./lib/bucketSync.js";
import { LOG_FILE as CORRECTIONS_LOG_FILE } from "./lib/correctionLog.js";
import { LOG_FILE as CLASSIFICATIONS_LOG_FILE } from "./lib/classificationLog.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" })); // base64 images inflate ~33% over raw bytes

// Unauthenticated: Render's own health check hits this with no headers, and it
// leaks nothing sensitive.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Everything below costs real money per request (Claude/SerpApi calls) —
// gate it behind the shared-secret check.
app.use(sharedSecretAuth);
app.use(classifyRouter);
app.use(priceSearchRouter);
app.use(outfitSuggestionsRouter);
app.use(barcodeLookupRouter);
app.use(correctionRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server] unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
});

const port = Number(process.env.PORT) || 3000;

// Restores both JSONL logs from their Hugging Face Storage Bucket (if configured
// — see bucketSync.ts) before accepting any traffic, so a Render restart's wiped
// local disk gets repopulated from durable storage first. No-ops near-instantly
// (before any AWS SDK client is even constructed) when bucket sync isn't
// configured, and each restore has its own internal timeout/error handling, so
// this never meaningfully delays or blocks startup on a real failure.
async function main() {
  await Promise.all([
    restoreFromBucket(CORRECTIONS_LOG_FILE, "corrections.jsonl"),
    restoreFromBucket(CLASSIFICATIONS_LOG_FILE, "classifications.jsonl"),
  ]);

  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn("[server] ANTHROPIC_API_KEY is not set — /classify will fail until server/.env is configured.");
    }
    if (!process.env.SERPAPI_KEY) {
      console.warn(
        "[server] SERPAPI_KEY is not set — /price-search will return no pricing data at all (SerpApi/Google " +
          "Shopping is now the only price/listing source in this app — eBay was removed entirely), and Outfit " +
          "Matches (/outfit-suggestions) will show keyword ideas with no purchasable items."
      );
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
    if (!isBucketSyncConfigured()) {
      console.warn(
        "[server] HF bucket sync is not configured (HF_BUCKET_S3_ENDPOINT/HF_BUCKET_NAME/" +
          "HF_BUCKET_ACCESS_KEY_ID/HF_BUCKET_SECRET_ACCESS_KEY) — correction/classification logs are " +
          "local-disk only and will be wiped on the next Render restart/redeploy."
      );
    }
  });
}

main();
