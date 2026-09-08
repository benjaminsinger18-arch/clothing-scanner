import { Router } from "express";
import { getUsageSnapshot } from "../lib/rateLimitTracker.js";

export const usageRouter = Router();

// Read-only visibility into the soft-cap counters in rateLimitTracker.ts — those
// were already being computed (getUsageSnapshot existed) but never exposed anywhere,
// meaning the only way to see how close a provider was to its cap was reading
// Render's console logs by hand. Mounted behind sharedSecretAuth like every other
// paid-call route in index.ts, even though this route itself makes no external
// calls — it still reveals usage-pattern information not meant to be public.
//
// Counts are in-memory and reset on server restart (see rateLimitTracker.ts's own
// top-of-file comment) — this reports the *current process's* counters, not a
// durable history.
usageRouter.get("/usage", (_req, res) => {
  res.json(getUsageSnapshot());
});
