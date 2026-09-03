import type { NextFunction, Request, Response } from "express";

const HEADER_NAME = "x-app-secret";

/**
 * Lightweight deterrent against random internet traffic hitting the deployed
 * backend and running up real Anthropic/SerpApi costs — NOT real security. The
 * secret ships inside the mobile app bundle (via EXPO_APP_SHARED_SECRET)
 * and is extractable by anyone who unpacks it; this only stops casual/automated
 * abuse of the bare URL, not a determined attacker. If APP_SHARED_SECRET isn't
 * set on the server, auth is skipped entirely (open) — matches this project's
 * pattern of degrading gracefully rather than hard-failing when a config value
 * is missing, so local dev works with zero setup.
 */
export function sharedSecretAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.APP_SHARED_SECRET;
  if (!expected) {
    next();
    return;
  }

  const provided = req.header(HEADER_NAME);
  if (provided === expected) {
    next();
    return;
  }

  res.status(401).json({ error: "unauthorized", reason: "Missing or incorrect X-App-Secret header" });
}
