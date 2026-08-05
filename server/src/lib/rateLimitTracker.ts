// Proactive daily-quota guards so we stop calling a provider before hitting its hard
// rate limit, rather than only reacting to 429s after the fact. In-memory only — counts
// reset on server restart, an acceptable approximation for a single-instance indie
// deployment (revisit with Redis if this ever needs to survive restarts / scale out).

interface Counter {
  count: number;
  dayKey: string;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetIfNewDay(counter: Counter): void {
  const key = todayKey();
  if (counter.dayKey !== key) {
    counter.dayKey = key;
    counter.count = 0;
  }
}

// eBay's Browse API documents a ~5,000 calls/day application-level limit; leave headroom
// since each "scan" can trigger more than one call (initial query + widen-retry).
const EBAY_DAILY_SOFT_CAP = 4500;
const ebayCounter: Counter = { count: 0, dayKey: todayKey() };

export function canMakeEbayCall(): boolean {
  resetIfNewDay(ebayCounter);
  return ebayCounter.count < EBAY_DAILY_SOFT_CAP;
}

export function recordEbayCall(): void {
  resetIfNewDay(ebayCounter);
  ebayCounter.count += 1;
}

export function getEbayCallCount(): number {
  resetIfNewDay(ebayCounter);
  return ebayCounter.count;
}
