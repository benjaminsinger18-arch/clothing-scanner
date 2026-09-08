// Local persistence for saved scans ("the Closet") — the app's first bit of
// state that survives past a single scan. Deliberately local-only (no backend
// involvement, no accounts): a device-local SQLite database is plenty for a
// single device's wardrobe list at this project's scale, and it keeps this
// feature shippable without a server/auth rework. Revisit with a real backend
// + sync if this ever needs to follow a user across devices.
//
// Was AsyncStorage-backed (one big JSON blob under a single key) until this
// file moved to expo-sqlite — AsyncStorage had no query support at all, so
// every read pulled the *entire* closet into memory and filtered/sorted in
// JS, which was fine at "a linear scan over a JSON blob" scale but is the
// wrong foundation for search/filter (see ClosetScreen's search box). SQLite
// gives that for free via indexed WHERE/ORDER BY, without a new native
// dependency (expo-sqlite ships as part of the Expo SDK). A one-time
// migration below moves any existing AsyncStorage data over on first launch
// after this change, so nobody's existing closet is silently lost.
//
// Each entry carries a small photo thumbnail (see compressForThumbnail in
// app/lib/compressImage.ts) — deliberately tiny (160px, low quality). Stored
// as a plain TEXT column here (SQLite has no meaningful per-column size
// ceiling the way AsyncStorage's practical ~6MB total did, but there's still
// no reason to store more than the thumbnail needs). Barcode-identified items
// never had a photo to begin with, so this is always optional, not just "not
// loaded yet."

import * as SQLite from "expo-sqlite";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ClassificationResult, PriceRange } from "@clothing-scanner/shared-types";
import { getSharedDb } from "./db";

export interface ClosetItem {
  id: string;
  /** ISO timestamp — also doubles as the sort key (newest first). */
  savedAt: string;
  classification: ClassificationResult;
  /** Snapshot of the retail estimate at save time, if pricing had loaded yet —
   * absent rather than blocking the save on a slow/failed pricing fetch. */
  priceRange?: PriceRange;
  /** A `data:` URI thumbnail of the actual scanned photo — see this file's
   * top comment. Absent for barcode-identified items. */
  photoThumbnail?: string;
}

// Pre-SQLite storage key — read once by migrateFromAsyncStorageIfNeeded below,
// then deleted, so this constant only ever matters on a device's first launch
// after this migration shipped.
const LEGACY_ASYNC_STORAGE_KEY = "closet:v1";
// Same cap as before the SQLite migration — no longer driven by AsyncStorage's
// practical size ceiling (see git history for that math), kept anyway as a
// reasonable "a wardrobe list, not an unbounded log" bound. Enforced in SQL
// (see addClosetItem) instead of a JS array .slice().
const MAX_CLOSET_ITEMS = 150;

/** Row shape as stored — a few columns pulled out of `classification` for
 * indexed search/filter (see ClosetScreen), plus the full classification as
 * JSON so nothing about it is lost to the denormalization. */
interface ClosetRow {
  id: string;
  saved_at: string;
  classification_json: string;
  price_range_json: string | null;
  photo_thumbnail: string | null;
}

function rowToClosetItem(row: ClosetRow): ClosetItem {
  return {
    id: row.id,
    savedAt: row.saved_at,
    classification: JSON.parse(row.classification_json) as ClassificationResult,
    priceRange: row.price_range_json ? (JSON.parse(row.price_range_json) as PriceRange) : undefined,
    photoThumbnail: row.photo_thumbnail ?? undefined,
  };
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Lazily opens (and migrates/initializes) the database exactly once per app
 * session — every exported function below routes through this rather than
 * calling `SQLite.openDatabaseAsync` directly, so there's a single shared
 * connection and a single migration run. */
function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = initDb();
  }
  return dbPromise;
}

async function initDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await getSharedDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS closet_items (
      id TEXT PRIMARY KEY NOT NULL,
      saved_at TEXT NOT NULL,
      garment_type TEXT NOT NULL,
      category TEXT NOT NULL,
      color TEXT NOT NULL,
      brand_guess TEXT,
      classification_json TEXT NOT NULL,
      price_range_json TEXT,
      photo_thumbnail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_closet_saved_at ON closet_items(saved_at);
    CREATE INDEX IF NOT EXISTS idx_closet_category ON closet_items(category);
  `);
  await migrateFromAsyncStorageIfNeeded(db);
  return db;
}

async function insertItem(db: SQLite.SQLiteDatabase, item: ClosetItem): Promise<void> {
  // INSERT OR IGNORE (rather than a plain INSERT) so the one-time AsyncStorage
  // migration below is safe to re-attempt if it's ever interrupted between
  // inserting rows and clearing the legacy key — a duplicate id is silently
  // skipped instead of throwing and aborting the whole migration partway.
  await db.runAsync(
    `INSERT OR IGNORE INTO closet_items
       (id, saved_at, garment_type, category, color, brand_guess, classification_json, price_range_json, photo_thumbnail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id,
    item.savedAt,
    item.classification.garmentType,
    item.classification.category,
    item.classification.color,
    item.classification.brandGuess,
    JSON.stringify(item.classification),
    item.priceRange ? JSON.stringify(item.priceRange) : null,
    item.photoThumbnail ?? null
  );
}

/** Runs once per device: if `closet:v1` still has data in AsyncStorage (i.e.
 * this app was used before the SQLite migration), copies every item into the
 * new table, then deletes the old key so this never runs again. Failures are
 * caught and logged rather than thrown — a failed migration should leave the
 * device exactly as it was (old data still sitting in AsyncStorage, available
 * to retry next launch) rather than crash the app on startup. */
async function migrateFromAsyncStorageIfNeeded(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_ASYNC_STORAGE_KEY);
    if (!raw) return; // Fresh install, or already migrated on a previous launch.

    const parsed: unknown = JSON.parse(raw);
    const legacyItems: ClosetItem[] = Array.isArray(parsed) ? (parsed as ClosetItem[]) : [];

    if (legacyItems.length > 0) {
      await db.withTransactionAsync(async () => {
        for (const item of legacyItems) {
          await insertItem(db, item);
        }
      });
      console.log(`[closetStorage] Migrated ${legacyItems.length} item(s) from AsyncStorage to SQLite.`);
    }

    await AsyncStorage.removeItem(LEGACY_ASYNC_STORAGE_KEY);
  } catch (err) {
    console.warn(
      "[closetStorage] AsyncStorage -> SQLite migration failed; will retry on next launch. Continuing with whatever SQLite already has:",
      err
    );
  }
}

/** Newest-first — matches how a "recently saved" list is expected to read. */
export async function getClosetItems(): Promise<ClosetItem[]> {
  return queryClosetItems();
}

export interface ClosetQuery {
  /** Case-insensitive substring match against garment type, category, color,
   * and brand — matches "you already own something like this" style search
   * rather than requiring an exact field match. Empty/whitespace-only is
   * treated as "no search filter". */
  search?: string;
  /** Exact category match (one of ClassificationResult's 8 category enum
   * values) — undefined means "any category". */
  category?: string;
}

/** The query-capable form of getClosetItems — split out once search/filter
 * needed more than "give me everything" (see ClosetScreen). Still
 * newest-first; SQLite's indexes (see initDb) keep both the search LIKE and
 * the category equality cheap even as the closet approaches its cap. */
export async function queryClosetItems(query: ClosetQuery = {}): Promise<ClosetItem[]> {
  const db = await getDb();
  const conditions: string[] = [];
  const params: string[] = [];

  if (query.category) {
    conditions.push("category = ?");
    params.push(query.category);
  }
  const search = query.search?.trim().toLowerCase();
  if (search) {
    const like = `%${search}%`;
    conditions.push(
      "(LOWER(garment_type) LIKE ? OR LOWER(category) LIKE ? OR LOWER(color) LIKE ? OR LOWER(brand_guess) LIKE ?)"
    );
    params.push(like, like, like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await db.getAllAsync<ClosetRow>(
    `SELECT id, saved_at, classification_json, price_range_json, photo_thumbnail FROM closet_items ${where} ORDER BY saved_at DESC`,
    params
  );
  return rows.map(rowToClosetItem);
}

/** Distinct categories actually present in the closet right now, for the
 * filter chip bar — deliberately unfiltered by any active search/category
 * (always reflects the whole closet), so the chip bar itself doesn't shrink
 * or flicker while someone's mid-search. Empty result means the closet has
 * no items at all (distinct from "no items match the current filter"). */
export async function getClosetCategories(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ category: string }>(
    "SELECT DISTINCT category FROM closet_items ORDER BY category ASC"
  );
  return rows.map((r) => r.category);
}

export async function addClosetItem(
  classification: ClassificationResult,
  priceRange?: PriceRange,
  photoThumbnail?: string
): Promise<ClosetItem> {
  const db = await getDb();
  const item: ClosetItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    classification,
    priceRange,
    photoThumbnail,
  };
  await insertItem(db, item);
  // Enforce the cap in SQL — the exact equivalent of the old
  // "prepend then .slice(0, MAX_CLOSET_ITEMS)" behavior, just expressed as a
  // single DELETE instead of reading everything into JS first.
  await db.runAsync(
    `DELETE FROM closet_items WHERE id NOT IN (
       SELECT id FROM closet_items ORDER BY saved_at DESC LIMIT ?
     )`,
    MAX_CLOSET_ITEMS
  );
  return item;
}

export async function removeClosetItem(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM closet_items WHERE id = ?", id);
}

/** Deletes every saved closet item — used by Settings' "Clear closet" action.
 * Deliberately a separate, explicit function rather than a `removeClosetItem`
 * loop (one SQL statement instead of N), and deliberately does NOT touch
 * saved outfits (see outfitStorage.ts) — an outfit whose items were all just
 * cleared simply shows "no longer in your closet" for each, same as any other
 * partial/full dangling-reference case, rather than being silently deleted too. */
export async function clearCloset(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM closet_items");
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
 * persisting. Pure function over an already-loaded item list, unaffected by
 * the AsyncStorage -> SQLite migration above. */
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
