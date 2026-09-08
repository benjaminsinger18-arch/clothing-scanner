// Storage for user-assembled outfits — a named combination of the user's own
// saved Closet items (see closetStorage.ts). Distinct from Results screen's
// "Outfit Matches" tab, which only ever *suggests* shoppable items to buy
// (plus a read-only keyword cross-reference into the closet); nothing there
// lets you actually assemble, name, and keep a combination of pieces you
// already own. This file is that missing half.
//
// An outfit is stored as a name + an ordered list of closet item ids, not a
// denormalized copy of those items' data — so if a closet item's saved price
// estimate or thumbnail is ever refreshed, every outfit referencing it reads
// the current version automatically. The tradeoff: removing a closet item
// that's part of a saved outfit leaves that outfit with a "dangling"
// reference rather than cascading the delete or blocking the removal — see
// `getOutfitsWithItems`, which resolves ids against the current closet and
// simply omits ones that no longer exist, rather than erroring.

import { getSharedDb } from "./db";
import { getClosetItems, type ClosetItem } from "./closetStorage";

export interface SavedOutfit {
  id: string;
  name: string;
  /** ISO timestamp — also the sort key (newest first). */
  savedAt: string;
  /** Ordered ClosetItem ids — the order the user assembled them in. */
  itemIds: string[];
}

/** A saved outfit with its closet items resolved and any now-missing ids
 * dropped — what the UI actually renders (see OutfitBuilderScreen /
 * OutfitsListScreen), rather than every screen re-resolving ids itself. */
export interface ResolvedOutfit extends SavedOutfit {
  items: ClosetItem[];
}

interface OutfitRow {
  id: string;
  name: string;
  saved_at: string;
  item_ids_json: string;
}

function rowToSavedOutfit(row: OutfitRow): SavedOutfit {
  return {
    id: row.id,
    name: row.name,
    savedAt: row.saved_at,
    itemIds: JSON.parse(row.item_ids_json) as string[],
  };
}

let schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  const db = await getSharedDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS outfits (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      item_ids_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outfits_saved_at ON outfits(saved_at);
  `);
}

function getDb() {
  if (!schemaReady) {
    schemaReady = ensureSchema();
  }
  return schemaReady.then(getSharedDb);
}

/** Newest-first, same convention as closetStorage's getClosetItems. */
export async function getOutfits(): Promise<SavedOutfit[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OutfitRow>(
    "SELECT id, name, saved_at, item_ids_json FROM outfits ORDER BY saved_at DESC"
  );
  return rows.map(rowToSavedOutfit);
}

/** getOutfits, plus each outfit's closet items resolved (missing ids
 * silently dropped — see this file's top comment). Reads the whole closet
 * once and resolves every outfit against it, rather than one query per
 * outfit, since the closet is small (capped at 150 items) and this avoids
 * an N+1 query pattern for someone with several saved outfits. */
export async function getOutfitsWithItems(): Promise<ResolvedOutfit[]> {
  const [outfits, closetItems] = await Promise.all([getOutfits(), getClosetItems()]);
  const byId = new Map(closetItems.map((item) => [item.id, item]));
  return outfits.map((outfit) => ({
    ...outfit,
    items: outfit.itemIds.map((id) => byId.get(id)).filter((item): item is ClosetItem => item !== undefined),
  }));
}

export async function addOutfit(name: string, itemIds: string[]): Promise<SavedOutfit> {
  const db = await getDb();
  const outfit: SavedOutfit = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    savedAt: new Date().toISOString(),
    itemIds,
  };
  await db.runAsync(
    "INSERT INTO outfits (id, name, saved_at, item_ids_json) VALUES (?, ?, ?, ?)",
    outfit.id,
    outfit.name,
    outfit.savedAt,
    JSON.stringify(outfit.itemIds)
  );
  return outfit;
}

export async function removeOutfit(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM outfits WHERE id = ?", id);
}
