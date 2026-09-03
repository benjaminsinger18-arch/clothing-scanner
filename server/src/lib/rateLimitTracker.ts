// Proactive quota guards so we stop calling a provider before hitting its hard rate
// limit, rather than only reacting to 429s after the fact. In-memory only — counts
// reset on server restart, an acceptable approximation for a single-instance indie
// deployment (revisit with Redis if this ever needs to survive restarts / scale out).

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

// --- eBay: Browse API documents a ~5,000 calls/day application-level limit; leave
// headroom since each "scan" can trigger more than one call (resale + new-condition
// searches, plus a widen-retry on empty results). ---
const EBAY_DAILY_SOFT_CAP = 4500;
const ebayCounter: Counter = { count: 0, periodKey: todayKey() };

export function canMakeEbayCall(): boolean {
  resetIfNewPeriod(ebayCounter, todayKey());
  return ebayCounter.count < EBAY_DAILY_SOFT_CAP;
}

export function recordEbayCall(): void {
  resetIfNewPeriod(ebayCounter, todayKey());
  ebayCounter.count += 1;
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

export function getUsageSnapshot() {
  resetIfNewPeriod(ebayCounter, todayKey());
  resetIfNewPeriod(serpApiCounter, monthKey());
  resetIfNewPeriod(visionCounter, monthKey());
  resetIfNewPeriod(geminiCounter, todayKey());
  resetIfNewPeriod(upcCounter, todayKey());
  resetIfNewPeriod(webSearchCounter, todayKey());
  return {
    ebay: { count: ebayCounter.count, cap: EBAY_DAILY_SOFT_CAP, period: "day" as const },
    serpapi: { count: serpApiCounter.count, cap: SERPAPI_MONTHLY_SOFT_CAP, period: "month" as const },
    vision: { count: visionCounter.count, cap: VISION_MONTHLY_SOFT_CAP, period: "month" as const },
    gemini: { count: geminiCounter.count, cap: GEMINI_DAILY_SOFT_CAP, period: "day" as const },
    upc: { count: upcCounter.count, cap: UPC_DAILY_SOFT_CAP, period: "day" as const },
    webSearch: { count: webSearchCounter.count, cap: WEB_SEARCH_DAILY_SOFT_CAP, period: "day" as const },
  };
}
