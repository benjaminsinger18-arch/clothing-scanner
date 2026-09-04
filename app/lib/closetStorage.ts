// Local persistence for saved scans ("the Closet") — the app's first bit of
// state that survives past a single scan. Deliberately local-only (no backend
// involvement, no accounts): AsyncStorage is plenty for a single device's
// wardrobe list at this project's scale, and it keeps this feature shippable
// without a server/auth rework. Revisit with a real backend + sync if this
// ever needs to follow a user across devices.
//
// No photo/thumbnail is stored — PreviewScreen/BarcodeScanScreen don't
// currently thread the captured image through to ResultsScreen (see
// navigation/types.ts), and plumbing a base64 image into every saved entry
// would risk hitting AsyncStorage's per-key size ceiling after a only a
// handful of saves. A closet entry is identified by its classification
// fields (garment/color/brand) instead, same as the rest of the app does
// today.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ClassificationResult, PriceRange } from "@clothing-scanner/shared-types";

export interface ClosetItem {
  id: string;
  /** ISO timestamp — also doubles as the sort key (newest first). */
  savedAt: string;
  classification: ClassificationResult;
  /** Snapshot of the retail estimate at save time, if pricing had loaded yet —
   * absent rather than blocking the save on a slow/failed pricing fetch. */
  priceRange?: PriceRange;
}

const STORAGE_KEY = "closet:v1";
// A generous ceiling, not an expected steady-state size — guards against
// unbounded growth on a device that's never uninstalled, same defensive
// posture as this app's other "cap it, don't let it grow forever" spots
// (see e.g. TtlCache's maxEntries on the backend).
const MAX_CLOSET_ITEMS = 300;

async function readAll(): Promise<ClosetItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClosetItem[]) : [];
  } catch (err) {
    // Corrupt/unexpected stored value — fail open to an empty closet rather
    // than crash the app over what's meant to be a convenience feature.
    console.warn("[closetStorage] Failed to read closet, starting empty:", err);
    return [];
  }
}

async function writeAll(items: ClosetItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

/** Newest-first — matches how a "recently saved" list is expected to read. */
export async function getClosetItems(): Promise<ClosetItem[]> {
  const items = await readAll();
  return [...items].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function addClosetItem(
  classification: ClassificationResult,
  priceRange?: PriceRange
): Promise<ClosetItem> {
  const items = await readAll();
  const item: ClosetItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    classification,
    priceRange,
  };
  // New items are prepended, so trimming to the cap from the end always drops
  // the oldest ones.
  await writeAll([item, ...items].slice(0, MAX_CLOSET_ITEMS));
  return item;
}

export async function removeClosetItem(id: string): Promise<void> {
  const items = await readAll();
  await writeAll(items.filter((i) => i.id !== id));
}

/** Matches saved closet items against an outfit-suggestion keyword phrase
 * (e.g. "navy chino pants") so Outfit Matches can offer "you already own
 * something like this" ahead of/alongside AI-guessed shoppable listings.
 * Same head-noun-match approach as the backend's filterToRelevantCategory
 * (serpApiClient.ts) — require the phrase's last word to appear in the
 * item's garment/category words before considering it a candidate at all,
 * then rank candidates by how many of the phrase's other words (color,
 * style modifiers) also overlap. Deliberately client-side and re-derived
 * per render rather than stored — the closet can grow/shrink between scans
 * and a suggestion's wording is scan-specific, so there's nothing here worth
 * persisting. */
export function findClosetMatches(items: ClosetItem[], keywords: string, limit = 3): ClosetItem[] {
  const kwWords = keywords.toLowerCase().split(/\s+/).filter(Boolean);
  const headNoun = kwWords[kwWords.length - 1];
  if (!headNoun) return [];

  const scored = items
    .map((item) => {
      const itemWords = new Set(
        `${item.classification.garmentType} ${item.classification.category} ${item.classification.color}`
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean)
      );
      if (!itemWords.has(headNoun)) return null;
      const overlap = kwWords.filter((w) => itemWords.has(w)).length;
      return { item, overlap };
    })
    .filter((x): x is { item: ClosetItem; overlap: number } => x !== null)
    .sort((a, b) => b.overlap - a.overlap);

  return scored.slice(0, limit).map((s) => s.item);
}
