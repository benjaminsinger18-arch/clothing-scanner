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

// --- Fashion-CLIP (Hugging Face Inference API): like Gemini/web-search above, sized
// as a runaway-cost/abuse circuit breaker rather than free-tier protection — HF's
// hosted Inference API free tier is itself rate-limited per-account, so this cap
// mostly exists to fail fast with a clear reason instead of hammering HF once their
// own limit is hit. Unlike Vision (called every scan) this only fires on the rare
// last-resort path in classifyImage (Claude + Gemini + Vision-hint retry all already
// failed), so realistic volume is a small fraction of total scans — this cap should
// essentially never be reached in practice. ---
const FASHION_CLIP_DAILY_SOFT_CAP = 100;
const fashionClipCounter: Counter = { count: 0, periodKey: todayKey() };

export function canMakeFashionClipCall(): boolean {
  resetIfNewPeriod(fashionClipCounter, todayKey());
  return fashionClipCounter.count < FASHION_CLIP_DAILY_SOFT_CAP;
}

export function recordFashionClipCall(): void {
  resetIfNewPeriod(fashionClipCounter, todayKey());
  fashionClipCounter.count += 1;
}

export function getUsageSnapshot() {
  resetIfNewPeriod(serpApiCounter, monthKey());
  resetIfNewPeriod(visionCounter, monthKey());
  resetIfNewPeriod(geminiCounter, todayKey());
  resetIfNewPeriod(upcCounter, todayKey());
  resetIfNewPeriod(webSearchCounter, todayKey());
  resetIfNewPeriod(serpApiOutfitCounter, monthKey());
  resetIfNewPeriod(fashionClipCounter, todayKey());
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
    fashionClip: { count: fashionClipCounter.count, cap: FASHION_CLIP_DAILY_SOFT_CAP, period: "day" as const },
  };
}
