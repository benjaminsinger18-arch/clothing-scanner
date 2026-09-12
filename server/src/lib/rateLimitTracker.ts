// Proactive quota guards so we stop calling a provider before hitting its hard rate
// limit, rather than only reacting to 429s after the fact. In-memory only — counts
// reset on server restart, an acceptable approximation for a single-instance indie
// deployment (revisit with Redis if this ever needs to survive restarts / scale out).
//
// Each provider below exposes two APIs: canMakeXCall()/recordXCall() (a plain
// read-then-separately-increment pair — kept for read-only/advisory checks,
// e.g. reading current usage without claiming a slot) and
// tryReserveXCall()/releaseXCall() (an atomic check+increment, with a
// rollback for a reservation that didn't end up costing anything real). Any
// call site gating a NEW outbound provider call should use the
// tryReserve/release pair, not canMake+record — calling canMakeXCall() then
// awaiting the network call then calling recordXCall() only once it resolves
// leaves a window, for the whole round-trip, where concurrent callers can all
// see the same not-yet-incremented count and all pass the check. See the
// "Reserve/release" section below for the full explanation.

import type { UsageSnapshot } from "@clothing-scanner/shared-types";

interface Counter {
  count: number;
  periodKey: string;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function resetIfNewPeriod(counter: Counter, currentKey: string): void {
  if (counter.periodKey !== currentKey) {
    counter.periodKey = currentKey;
    counter.count = 0;
  }
}

// --- Reserve/release: the actual race-free way to consume a slot ---
//
// Every provider below used to be gated by calling canMakeXCall() (a read-only
// check), then awaiting the outbound network call, then calling recordXCall()
// (the increment) only once that call resolved. That leaves a window, for the
// entire duration of the network round-trip, where the counter hasn't moved
// yet — concurrent requests arriving in that window all see the same
// not-yet-incremented count, all pass canMakeXCall(), and all fire their own
// outbound call, so the soft cap can be overrun by however many requests are
// in flight at once near the cap. (This can't happen from a single check+
// increment running back-to-back with no `await` between them — Node is
// single-threaded, so nothing else runs until the next await point — which is
// exactly why tryReserve below does the check and the increment as one
// synchronous step, called BEFORE the network call starts rather than after
// it resolves.)
//
// tryReserve() claims a slot up front; release() gives it back if the
// reservation turned out not to cost anything real (e.g. the outbound request
// never reached the provider at all — a connection/DNS-level failure, not an
// HTTP error response). Call sites should still keep the reservation (not
// release it) for a response that did reach the provider, even an error one
// (429/5xx), since that request was actually sent and may count against the
// provider's own quota regardless of how it resolved — matching this file's
// original recording behavior, which recorded unconditionally on any resolved
// fetch.
function tryReserve(counter: Counter, currentKey: string, cap: number): boolean {
  resetIfNewPeriod(counter, currentKey);
  if (counter.count >= cap) return false;
  counter.count += 1;
  return true;
}

function release(counter: Counter): void {
  if (counter.count > 0) counter.count -= 1;
}

// --- SerpApi: free tier is 250 searches/month. Leave meaningful headroom since this
// is the tightest quota in the stack — see README for the "~80-100 scans/month"
// estimate this cap is meant to protect. ---
const SERPAPI_MONTHLY_SOFT_CAP = 220;
const serpApiCounter: Counter = { count: 0, periodKey: monthKey() };

export function canMakeSerpApiCall(): boolean {
  resetIfNewPeriod(serpApiCounter, monthKey());
  return serpApiCounter.count < SERPAPI_MONTHLY_SOFT_CAP;
}

export function recordSerpApiCall(): void {
  resetIfNewPeriod(serpApiCounter, monthKey());
  serpApiCounter.count += 1;
}

/** Race-free check+increment — see this file's "Reserve/release" comment
 * above. Call this instead of canMakeSerpApiCall()+recordSerpApiCall()
 * around a new outbound call. */
export function tryReserveSerpApiCall(): boolean {
  return tryReserve(serpApiCounter, monthKey(), SERPAPI_MONTHLY_SOFT_CAP);
}

export function releaseSerpApiCall(): void {
  release(serpApiCounter);
}

// --- Google Cloud Vision: called on every scan now (see claudeClient.ts's
// classifyImage — an always-on ensemble signal, not just a failure fallback), so
// volume tracks scan volume directly. Google's free tier is 1,000 units/month *per
// feature type*; at this project's ~80-100 scans/month estimate (see SerpApi's cap
// below) even 900 calls/month leaves each feature bucket under its own free
// allotment, with headroom against usage growing faster than expected. ---
const VISION_MONTHLY_SOFT_CAP = 900;
const visionCounter: Counter = { count: 0, periodKey: monthKey() };

export function canMakeVisionCall(): boolean {
  resetIfNewPeriod(visionCounter, monthKey());
  return visionCounter.count < VISION_MONTHLY_SOFT_CAP;
}

export function recordVisionCall(): void {
  resetIfNewPeriod(visionCounter, monthKey());
  visionCounter.count += 1;
}

export function tryReserveVisionCall(): boolean {
  return tryReserve(visionCounter, monthKey(), VISION_MONTHLY_SOFT_CAP);
}

export function releaseVisionCall(): void {
  release(visionCounter);
}

// --- Gemini: unlike every other cap in this file, Gemini 3.1 Pro has no free tier
// at all — it's billed from the first call. This cap isn't protecting a free
// allotment, it's a pure runaway-cost circuit breaker (e.g. against a bug that
// loops classification calls). Sized well above realistic usage (~80-100
// scans/month, see SerpApi's cap above) with a daily period so a bad day can't run
// up an unbounded bill before anyone notices. ---
const GEMINI_DAILY_SOFT_CAP = 300;
const geminiCounter: Counter = { count: 0, periodKey: todayKey() };

export function canMakeGeminiCall(): boolean {
  resetIfNewPeriod(geminiCounter, todayKey());
  return geminiCounter.count < GEMINI_DAILY_SOFT_CAP;
}

export function recordGeminiCall(): void {
  resetIfNewPeriod(geminiCounter, todayKey());
  geminiCounter.count += 1;
}

export function tryReserveGeminiCall(): boolean {
  return tryReserve(geminiCounter, todayKey(), GEMINI_DAILY_SOFT_CAP);
}

export function releaseGeminiCall(): void {
  release(geminiCounter);
}

// --- UPCitemdb: trial tier is keyless and its 100 req/day quota is shared across
// all anonymous callers, not ours alone — cap well under that so this app's own
// usage doesn't tip an already-shared pool over the edge for everyone else. ---
const UPC_DAILY_SOFT_CAP = 80;
const upcCounter: Counter = { count: 0, periodKey: todayKey() };

export function canMakeUpcCall(): boolean {
  resetIfNewPeriod(upcCounter, todayKey());
  return upcCounter.count < UPC_DAILY_SOFT_CAP;
}

export function recordUpcCall(): void {
  resetIfNewPeriod(upcCounter, todayKey());
  upcCounter.count += 1;
}

export function tryReserveUpcCall(): boolean {
  return tryReserve(upcCounter, todayKey(), UPC_DAILY_SOFT_CAP);
}

export function releaseUpcCall(): void {
  release(upcCounter);
}

// --- Claude web search (correction verification): like Gemini above, this has no
// free tier — $10 per 1,000 searches plus standard token costs, billed from the
// first call. Unlike every other provider in this file, though, it's not tied to
// scan volume at all: it only fires when a user explicitly disputes a result and
// submits a correction, a rare, deliberate action rather than something that runs
// on every scan. Sized far below Gemini's 300/day cap to reflect that — this is a
// pure runaway-cost circuit breaker (e.g. a client bug retry-looping corrections),
// not quota protection against realistic organic usage. ---
const WEB_SEARCH_DAILY_SOFT_CAP = 50;
const webSearchCounter: Counter = { count: 0, periodKey: todayKey() };

export function canMakeWebSearchCall(): boolean {
  resetIfNewPeriod(webSearchCounter, todayKey());
  return webSearchCounter.count < WEB_SEARCH_DAILY_SOFT_CAP;
}

export function recordWebSearchCall(): void {
  resetIfNewPeriod(webSearchCounter, todayKey());
  webSearchCounter.count += 1;
}

export function tryReserveWebSearchCall(): boolean {
  return tryReserve(webSearchCounter, todayKey(), WEB_SEARCH_DAILY_SOFT_CAP);
}

export function releaseWebSearchCall(): void {
  release(webSearchCounter);
}

// --- SerpApi (outfit-suggestions slice): a dedicated sub-cap, checked in addition
// to the shared SERPAPI_MONTHLY_SOFT_CAP above, protecting /price-search's usage
// from being crowded out by outfit-suggestions' own SerpApi usage — the two
// features share one external 250/month quota. server/src/routes/outfitSuggestions.ts
// only ever searches the *first* suggestion per request (worked out in that file's
// own comment — searching all 3-5 would add 240-500 calls/month on top of
// /price-search's own ~80-100/month, blowing through both the 220 soft cap and the
// real 250 hard cap), so worst case here is ~1 call/scan, ~80-100/month. 100 leaves
// a little slack over that, keeping the combined total (160-200/month) safely under
// the shared 220/month soft cap. ---
const SERPAPI_OUTFIT_MONTHLY_SOFT_CAP = 100;
const serpApiOutfitCounter: Counter = { count: 0, periodKey: monthKey() };

export function canMakeSerpApiOutfitCall(): boolean {
  resetIfNewPeriod(serpApiOutfitCounter, monthKey());
  return serpApiOutfitCounter.count < SERPAPI_OUTFIT_MONTHLY_SOFT_CAP;
}

export function recordSerpApiOutfitCall(): void {
  resetIfNewPeriod(serpApiOutfitCounter, monthKey());
  serpApiOutfitCounter.count += 1;
}

export function tryReserveSerpApiOutfitCall(): boolean {
  return tryReserve(serpApiOutfitCounter, monthKey(), SERPAPI_OUTFIT_MONTHLY_SOFT_CAP);
}

export function releaseSerpApiOutfitCall(): void {
  release(serpApiOutfitCounter);
}

export function getUsageSnapshot(): UsageSnapshot {
  resetIfNewPeriod(serpApiCounter, monthKey());
  resetIfNewPeriod(visionCounter, monthKey());
  resetIfNewPeriod(geminiCounter, todayKey());
  resetIfNewPeriod(upcCounter, todayKey());
  resetIfNewPeriod(webSearchCounter, todayKey());
  resetIfNewPeriod(serpApiOutfitCounter, monthKey());
  return {
    serpapi: { count: serpApiCounter.count, cap: SERPAPI_MONTHLY_SOFT_CAP, period: "month" as const },
    vision: { count: visionCounter.count, cap: VISION_MONTHLY_SOFT_CAP, period: "month" as const },
    gemini: { count: geminiCounter.count, cap: GEMINI_DAILY_SOFT_CAP, period: "day" as const },
    upc: { count: upcCounter.count, cap: UPC_DAILY_SOFT_CAP, period: "day" as const },
    webSearch: { count: webSearchCounter.count, cap: WEB_SEARCH_DAILY_SOFT_CAP, period: "day" as const },
    serpapiOutfit: {
      count: serpApiOutfitCounter.count,
      cap: SERPAPI_OUTFIT_MONTHLY_SOFT_CAP,
      period: "month" as const,
    },
  };
}
