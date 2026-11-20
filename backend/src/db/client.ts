import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

/** backend/drizzle: the same relative path from src/db (tsx) and dist/db (build). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Any Drizzle Postgres database with our schema: node-postgres in production, PGlite locally and in tests. */
export type AppPgDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Database = {
  /** postgres = DATABASE_URL (Neon); embedded = in-process PGlite, data lives until restart. */
  kind: 'postgres' | 'embedded';
  db: AppPgDatabase;
  /** Round-trip to Postgres; used by the health check. */
  ping: () => Promise<void>;
  /** Applies pending SQL migrations from backend/drizzle (idempotent). */
  migrate: () => Promise<void>;
  close: () => Promise<void>;
};

export function createDatabase(connectionString: string): Database {
  const pool = new pg.Pool({
    connectionString,
    // Neon free tier: small pool, quick release so the compute can auto-suspend.
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzle({ client: pool, schema });
  return {
    kind: 'postgres',
    db,
    ping: async () => {
      await pool.query('select 1');
    },
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => pool.end(),
  };
}

/**
 * In-process Postgres (PGlite) for local work without DATABASE_URL and for tests: the same SQL, the same
 * migrations, so every module needs only its Drizzle repository. Loaded lazily; it is a dev dependency.
 */
export async function createEmbeddedDatabase(): Promise<Database> {
  const [{ PGlite }, { drizzle: drizzlePglite }, { migrate: migratePglite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
  ]);
  const client = new PGlite();
  const db = drizzlePglite({ client, schema });
  return {
    kind: 'embedded',
    db,
    ping: async () => {
      await client.query('select 1');
    },
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => client.close(),
  };
}

/** Empties every application table (tests only). Migration bookkeeping lives in the "drizzle" schema. */
export async function truncateAll(database: Database): Promise<void> {
  const rows = await database.db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = (rows as unknown as { rows?: { tablename: string }[] }).rows ?? (rows as unknown as { tablename: string }[]);
  if (tables.length === 0) return;
  await database.db.execute(sql.raw(`truncate ${tables.map((t) => `"${t.tablename}"`).join(', ')} restart identity cascade`));
}
