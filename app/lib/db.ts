// Single shared SQLite connection, used by both closetStorage.ts and
// outfitStorage.ts — opening the same database file twice would work (SQLite
// itself tolerates multiple connections to one file), but sharing one
// `SQLiteDatabase` instance means both modules' writes serialize through the
// same connection rather than two independent ones potentially racing.
//
// This file only opens the database — it does NOT create any tables. Each
// storage module owns its own schema (`CREATE TABLE IF NOT EXISTS ...`) and
// runs it lazily the first time that module is used, keyed off its own
// module-level cached promise. That keeps "what tables exist" colocated with
// the code that reads/writes them, instead of one shared schema file every
// feature has to touch.

import * as SQLite from "expo-sqlite";

const DB_NAME = "closet.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getSharedDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}
