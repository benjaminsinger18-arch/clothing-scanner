// Unit tests for rateLimitTracker.ts's counter arithmetic (canMakeXCall/
// recordXCall pairs, and the cap threshold each protects).
//
// Every counter here is MODULE-LEVEL mutable state (see rateLimitTracker.ts's
// own top comment) — a `let` initialized once at first import, shared by
// every caller for the life of the process. That's fine for the real server
// (one counter per provider, for its whole process lifetime) but means tests
// can't just import the module once at the top of this file the normal way —
// every test would see whatever count the previous test left behind. Each
// test below re-imports the module fresh via vi.resetModules() + a dynamic
// import(), so every test starts from an untouched, zero-count module.
//
// NOT tested here: day/month period rollover (todayKey()/monthKey() call
// `new Date()` directly, with no injectable clock) — that would need either a
// fake-timers setup spanning a real day/month boundary or a refactor to
// accept an injected clock, neither of which this pass attempts. What's
// tested is the arithmetic within a single period: counting up, and the
// cap/threshold check at the boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RateLimitTracker from "./rateLimitTracker.js";

async function freshModule(): Promise<typeof RateLimitTracker> {
  vi.resetModules();
  return import("./rateLimitTracker.js");
}

describe("rateLimitTracker", () => {
  let mod: typeof RateLimitTracker;

  beforeEach(async () => {
    mod = await freshModule();
  });

  it("starts every counter at 0 with calls allowed", () => {
    const usage = mod.getUsageSnapshot();
    expect(usage.serpapi).toEqual({ count: 0, cap: 220, period: "month" });
    expect(usage.vision).toEqual({ count: 0, cap: 900, period: "month" });
    expect(usage.gemini).toEqual({ count: 0, cap: 300, period: "day" });
    expect(usage.upc).toEqual({ count: 0, cap: 80, period: "day" });
    expect(usage.webSearch).toEqual({ count: 0, cap: 50, period: "day" });
    expect(usage.serpapiOutfit).toEqual({ count: 0, cap: 100, period: "month" });

    expect(mod.canMakeSerpApiCall()).toBe(true);
    expect(mod.canMakeVisionCall()).toBe(true);
    expect(mod.canMakeGeminiCall()).toBe(true);
    expect(mod.canMakeUpcCall()).toBe(true);
    expect(mod.canMakeWebSearchCall()).toBe(true);
    expect(mod.canMakeSerpApiOutfitCall()).toBe(true);
  });

  it("increments the right counter and only that counter", () => {
    mod.recordSerpApiCall();
    mod.recordSerpApiCall();
    mod.recordGeminiCall();

    const usage = mod.getUsageSnapshot();
    expect(usage.serpapi.count).toBe(2);
    expect(usage.gemini.count).toBe(1);
    // Every other counter untouched by those three calls.
    expect(usage.vision.count).toBe(0);
    expect(usage.upc.count).toBe(0);
    expect(usage.webSearch.count).toBe(0);
    expect(usage.serpapiOutfit.count).toBe(0);
  });

  it("keeps the shared SerpApi counter (price-search) and the outfit sub-cap independent", () => {
    // serpapiOutfit is a *dedicated sub-cap* checked in addition to the
    // shared serpapi cap (see rateLimitTracker.ts's own comment on why) — one
    // provider, two counters, tracked separately.
    mod.recordSerpApiCall();
    mod.recordSerpApiOutfitCall();
    const usage = mod.getUsageSnapshot();
    expect(usage.serpapi.count).toBe(1);
    expect(usage.serpapiOutfit.count).toBe(1);
  });

  it("allows calls right up to the cap, then blocks at it", () => {
    // webSearch has the smallest cap (50/day) — cheapest to actually reach.
    for (let i = 0; i < 50; i++) {
      expect(mod.canMakeWebSearchCall()).toBe(true);
      mod.recordWebSearchCall();
    }
    expect(mod.getUsageSnapshot().webSearch.count).toBe(50);
    expect(mod.canMakeWebSearchCall()).toBe(false);
  });

  it("does not go negative or otherwise misbehave if recorded past the cap", () => {
    // canMakeWebSearchCall is a soft advisory check — nothing stops a caller
    // from calling recordWebSearchCall() without checking first (e.g. a race
    // between the check and the call). The counter should just keep counting,
    // not wrap or throw.
    for (let i = 0; i < 55; i++) {
      mod.recordWebSearchCall();
    }
    expect(mod.getUsageSnapshot().webSearch.count).toBe(55);
    expect(mod.canMakeWebSearchCall()).toBe(false);
  });

  it("gives every provider its own independent cap boundary", () => {
    // upc's cap (80/day) is the next-smallest — cheap enough to also reach
    // directly, confirming the cap check uses that provider's own cap
    // constant, not e.g. webSearch's by accident.
    for (let i = 0; i < 80; i++) {
      mod.recordUpcCall();
    }
    expect(mod.canMakeUpcCall()).toBe(false);
    // webSearch, untouched in this test, is still well under its own cap.
    expect(mod.canMakeWebSearchCall()).toBe(true);
  });

  // tryReserveXCall()/releaseXCall() — the race-free pair every provider
  // client now uses instead of canMakeXCall()+recordXCall() around a new
  // outbound call (see rateLimitTracker.ts's "Reserve/release" comment for
  // the bug this closes: canMake+record leaves a window, for the whole
  // network round-trip, where concurrent callers can all see the
  // not-yet-incremented count and all pass the check).
  describe("tryReserve/release", () => {
    it("reserves exactly up to the cap and blocks beyond it, without incrementing on a blocked attempt", () => {
      for (let i = 0; i < 50; i++) {
        expect(mod.tryReserveWebSearchCall()).toBe(true);
      }
      expect(mod.getUsageSnapshot().webSearch.count).toBe(50);
      expect(mod.tryReserveWebSearchCall()).toBe(false);
      expect(mod.getUsageSnapshot().webSearch.count).toBe(50);
    });

    it("release() gives a slot back, and never takes the counter below 0", () => {
      mod.tryReserveWebSearchCall();
      mod.tryReserveWebSearchCall();
      expect(mod.getUsageSnapshot().webSearch.count).toBe(2);
      mod.releaseWebSearchCall();
      expect(mod.getUsageSnapshot().webSearch.count).toBe(1);
      mod.releaseWebSearchCall();
      mod.releaseWebSearchCall(); // one more release than was ever reserved
      expect(mod.getUsageSnapshot().webSearch.count).toBe(0);
    });

    it("stays exactly at the cap under concurrent reservations that each await afterward — the exact scenario that broke the old canMake+record pattern", async () => {
      // Fill to one slot below the cap.
      for (let i = 0; i < 49; i++) mod.tryReserveWebSearchCall();
      expect(mod.getUsageSnapshot().webSearch.count).toBe(49);

      // Five "concurrent" callers each reserve, then await (simulating the
      // outbound network call). Only one slot is left, so only one of the
      // five should succeed — with the old canMakeWebSearchCall()-then-
      // recordWebSearchCall()-after-the-await pattern, all five could have
      // passed the check before any of them recorded, overrunning the cap.
      // tryReserve can't be fooled this way because the check and the
      // increment happen in the same synchronous step, before the `await`.
      const reserved = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const ok = mod.tryReserveWebSearchCall();
          await Promise.resolve(); // yield to the event loop, like a real fetch would
          return ok;
        })
      );
      expect(reserved.filter(Boolean)).toHaveLength(1);
      expect(mod.getUsageSnapshot().webSearch.count).toBe(50);
    });
  });
});
