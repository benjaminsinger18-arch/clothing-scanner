// Wear history for saved Closet items — feeds cost-per-wear (ClosetDetailScreen)
// and the "haven't worn lately" list (InsightsScreen). Deliberately its own
// table/module rather than a column on closet_items: a closet item can be worn
// any number of times, so this needs to be one row per wear, not one column.
//
// Rows reference a closet item by id but carry no other closet-item data (no
// denormalized snapshot) — same "store the reference, resolve it live"
// approach as outfitStorage.ts's item_ids_json. Unlike outfits' dangling-
// reference tolerance though, a wear-log row for a closet item that no longer
// exists has no value on its own (nothing else points back at it the way an
// outfit's name/other items still do) — see deleteWearLogForItem, called from
// closetStorage.ts's removeClosetItem and clearCloset so wear rows are always
// cleaned up alongside the closet item they belong to.

import { getSharedDb } from "./db";

export interface WearStats {
  /** Total logged wears for this item — 0 means "never marked as worn", not
   * "no data yet" (this module has no other notion of "unknown"). */
  count: number;
  /** ISO timestamp of the most recent wear, or null if count is 0. */
  lastWornAt: string | null;
}

const NEVER_WORN: WearStats = { count: 0, lastWornAt: null };

let schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  const db = await getSharedDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS wear_log (
      id TEXT PRIMARY KEY NOT NULL,
      closet_item_id TEXT NOT NULL,
      worn_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wear_log_closet_item_id ON wear_log(closet_item_id);
  `);
}

function getDb() {
  if (!schemaReady) {
    schemaReady = ensureSchema();
  }
  return schemaReady.then(getSharedDb);
}

/** Logs one wear of a closet item, timestamped now. */
export async function logWear(closetItemId: string): Promise<WearStats> {
  const db = await getDb();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const wornAt = new Date().toISOString();
  await db.runAsync("INSERT INTO wear_log (id, closet_item_id, worn_at) VALUES (?, ?, ?)", id, closetItemId, wornAt);
  return getWearStats(closetItemId);
}

/** Wear count + most recent wear date for a single closet item — used by
 * ClosetDetailScreen, which only ever needs one item's stats at a time. */
export async function getWearStats(closetItemId: string): Promise<WearStats> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number; last_worn_at: string | null }>(
    "SELECT COUNT(*) AS count, MAX(worn_at) AS last_worn_at FROM wear_log WHERE closet_item_id = ?",
    closetItemId
  );
  if (!row || row.count === 0) return NEVER_WORN;
  return { count: row.count, lastWornAt: row.last_worn_at };
}

/** Wear stats for every closet item that has at least one logged wear, keyed
 * by closet item id — used by InsightsScreen, which needs the whole closet's
 * wear history at once rather than one query per item (avoids an N+1 query
 * pattern the same way getOutfitsWithItems avoids one for outfits). An item
 * with no entry in the returned map has never been worn. */
export async function getAllWearStats(): Promise<Map<string, WearStats>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ closet_item_id: string; count: number; last_worn_at: string | null }>(
    "SELECT closet_item_id, COUNT(*) AS count, MAX(worn_at) AS last_worn_at FROM wear_log GROUP BY closet_item_id"
  );
  return new Map(rows.map((r) => [r.closet_item_id, { count: r.count, lastWornAt: r.last_worn_at }]));
}

/** Deletes wear history for one closet item — called whenever that item is
 * removed (see closetStorage.ts's removeClosetItem). */
export async function deleteWearLogForItem(closetItemId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM wear_log WHERE closet_item_id = ?", closetItemId);
}

/** Deletes all wear history — called from closetStorage.ts's clearCloset so
 * clearing the closet doesn't leave every wear row orphaned. */
export async function clearWearLog(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM wear_log");
}
