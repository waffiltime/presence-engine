import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const sqlite = new Database('presence.db');
sqlite.pragma('journal_mode = WAL');   // concurrent reads + one writer
sqlite.pragma('busy_timeout = 5000');  // a blocked write waits 5s instead of throwing immediately
export const db = drizzle(sqlite, { schema });

// Close the native handle before process exit. On Windows, calling process.exit()
// while better-sqlite3's handle is still open races libuv teardown
// (UV_HANDLE_CLOSING assertion). CLI entrypoints call this before exiting.
export function closeDb(): void {
  sqlite.close();
}
