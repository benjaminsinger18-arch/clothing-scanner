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

// --- Google Cloud Vision: only called as a fallback when Claude can't identify an
// item at all, so volume should be low — but cap it anyway since it's billed per
// request past the free monthly allotment. ---
const VISION_DAILY_SOFT_CAP = 150;
const visionCounter: Counter = { count: 0, periodKey: todayKey() };

export function canMakeVisionCall(): boolean {
  resetIfNewPeriod(visionCounter, todayKey());
  return visionCounter.count < VISION_DAILY_SOFT_CAP;
}

export function recordVisionCall(): void {
  resetIfNewPeriod(visionCounter, todayKey());
  visionCounter.count += 1;
}

export function getUsageSnapshot() {
  resetIfNewPeriod(ebayCounter, todayKey());
  resetIfNewPeriod(serpApiCounter, monthKey());
  resetIfNewPeriod(visionCounter, todayKey());
  return {
    ebay: { count: ebayCounter.count, cap: EBAY_DAILY_SOFT_CAP, period: "day" as const },
    serpapi: { count: serpApiCounter.count, cap: SERPAPI_MONTHLY_SOFT_CAP, period: "month" as const },
    vision: { count: visionCounter.count, cap: VISION_DAILY_SOFT_CAP, period: "day" as const },
  };
}
