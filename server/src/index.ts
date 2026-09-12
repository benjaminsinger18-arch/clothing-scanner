import "dotenv/config";
// Must be imported before any router/route file below — it patches Express's
// route-handling internals so a rejected promise from an `async (req, res) =>
// {}` handler reaches the error middleware via `next(err)` automatically.
// Without this, Express 4 (unlike 5) silently drops async rejections that
// aren't explicitly caught and forwarded — today every service function
// happens to swallow its own errors instead of throwing, but that was an
// unenforced convention, not a framework guarantee: one future bug that
// throws past its local try/catch would otherwise become an unhandled
// rejection that (per Node's default since v15) kills the whole process,
// dropping every other in-flight request along with it, not just the
// offending one.
import "express-async-errors";
import cors from "cors";
import express from "express";
import { classifyRouter } from "./routes/classify.js";
import { outfitSuggestionsRouter } from "./routes/outfitSuggestions.js";
import { priceSearchRouter } from "./routes/priceSearch.js";
import { barcodeLookupRouter } from "./routes/barcodeLookup.js";
import { correctionRouter } from "./routes/correction.js";
import { usageRouter } from "./routes/usage.js";
import { sharedSecretAuth } from "./lib/sharedSecretAuth.js";
import { restoreFromBucket, isBucketSyncConfigured } from "./lib/bucketSync.js";
import { LOG_FILE as CORRECTIONS_LOG_FILE } from "./lib/correctionLog.js";
import { LOG_FILE as CLASSIFICATIONS_LOG_FILE } from "./lib/classificationLog.js";

const app = express();

app.use(cors());

// Unauthenticated: Render's own health check hits this with no headers, and it
// leaks nothing sensitive.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// The shared-secret check runs BEFORE body parsing, not after — deliberately.
// It used to run after express.json(), which meant an unauthenticated caller
// with no X-App-Secret still made the server buffer/parse up to 10MB per
// request before being rejected with 401, undercutting the whole point of
// gating "costs real money" endpoints behind auth (the cost here is parse
// CPU/memory, not a paid provider call, but it's still free abuse). Now a
// request with no/wrong secret is rejected before any body parsing happens.
app.use(sharedSecretAuth);
app.use(express.json({ limit: "10mb" })); // base64 images inflate ~33% over raw bytes

// Everything below costs real money per request (Claude/SerpApi calls).
app.use(classifyRouter);
app.use(priceSearchRouter);
app.use(outfitSuggestionsRouter);
app.use(barcodeLookupRouter);
app.use(correctionRouter);
app.use(usageRouter);

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

// Last-resort backstop, not the primary defense (that's express-async-errors
// above, which handles the common case — a rejected promise inside a route
// handler — by turning it into a normal per-request 500). These two cover
// what express-async-errors can't: a rejection from code running outside the
// request/response cycle entirely (e.g. bucketSync.ts's fire-and-forget
// upload, or the eval/summarize scripts if ever imported into a long-running
// process) and any genuinely uncaught synchronous exception. Node's default
// behavior for both, since v15, is to crash the whole process — killing every
// other in-flight request along with whatever actually triggered the error.
// Logging and staying alive trades a theoretical "the process might be in an
// inconsistent state" risk for a concrete one (every concurrent user gets
// disconnected); for this app's blast-radius (a stateless-per-request API,
// no in-memory data whose corruption would matter beyond the rate-limit
// counters, which are already best-effort/in-memory and safe to keep using
// even if slightly stale) that trade favors staying up.
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaught exception:", err);
});

main();
