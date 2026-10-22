import path from "node:path";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Works for both a top-level database and a transaction handle. */
export type DB = PgDatabase<any, typeof schema>;
export type Tx = DB;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

/** Create an isolated database. No url → in-memory PGlite (used by tests). */
export async function createDb(opts: { url?: string; pgliteDir?: string } = {}): Promise<{ db: DB; close: () => Promise<void> }> {
  if (opts.url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: opts.url, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as DB, close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (opts.pgliteDir) (await import("node:fs")).mkdirSync(opts.pgliteDir, { recursive: true });
  const client = new PGlite(opts.pgliteDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as DB, close: () => client.close() };
}

const g = globalThis as unknown as { __kicklogDb?: Promise<DB> };

/** Process-wide database. DATABASE_URL → Postgres; otherwise embedded PGlite in ./.data/pglite. */
export function getDb(): Promise<DB> {
  if (!g.__kicklogDb) {
    const url = process.env.DATABASE_URL?.trim();
    g.__kicklogDb = createDb(
      url ? { url } : { pgliteDir: process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite") },
    ).then((r) => r.db);
    g.__kicklogDb.catch(() => {
      g.__kicklogDb = undefined;
    });
  }
  return g.__kicklogDb;
}

export { schema };
