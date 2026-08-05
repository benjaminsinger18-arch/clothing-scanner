import "dotenv/config";
import cors from "cors";
import express from "express";
import { classifyRouter } from "./routes/classify.js";
import { priceSearchRouter } from "./routes/priceSearch.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" })); // base64 images inflate ~33% over raw bytes

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(classifyRouter);
app.use(priceSearchRouter);

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
    console.warn("[server] EBAY_CLIENT_ID/EBAY_CLIENT_SECRET are not set — /price-search will fail until configured.");
  }
});
