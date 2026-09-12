import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const HEADER_NAME = "x-app-secret";

/** Plain `===` on secrets leaks timing information proportional to how many
 * leading bytes match, which a patient attacker can use to recover the value
 * byte-by-byte. Low-severity here specifically — the secret is already
 * documented above as extractable straight from the app bundle, so timing
 * attacks aren't this endpoint's weakest link — but `timingSafeEqual` costs
 * nothing to use correctly, so there's no reason to leave the cheaper
 * side-channel open. Requires equal-length buffers, hence the length check
 * before calling it (a length mismatch alone would otherwise throw). */
function secretsMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}

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
  if (provided !== undefined && secretsMatch(provided, expected)) {
    next();
    return;
  }

  res.status(401).json({ error: "unauthorized", reason: "Missing or incorrect X-App-Secret header" });
}
