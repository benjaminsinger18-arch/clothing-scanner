// Generic in-memory TTL cache — used to avoid re-spending quota on identical
// requests to rate-limited external providers (SerpApi, UPCitemdb). Same
// in-memory/single-instance caveat as rateLimitTracker.ts: cleared on
// restart/redeploy, an acceptable approximation for a single-instance indie
// deployment (revisit with Redis if this ever needs to survive restarts or
// scale out — see rateLimitTracker.ts's identical note).
//
// Deliberately not a general npm dependency (e.g. lru-cache) — the need here
// is exactly "expire after N ms, cap total size," which is a handful of lines
// to own directly rather than a dependency to track.

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>();

  /** @param ttlMs how long an entry stays valid after being set.
   *  @param maxEntries cheap unbounded-growth guard — once full, the oldest
   *  entry (by insertion order, which `Map` preserves) is evicted to make
   *  room. Not real LRU (a re-set doesn't bump an existing key's position),
   *  but good enough at this project's request volume; a proper LRU would be
   *  overkill for a cache this size. */
  constructor(private readonly ttlMs: number, private readonly maxEntries = 500) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
