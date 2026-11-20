import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

/** backend/drizzle: the same relative path from src/db (tsx) and dist/db (build). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export type Database = {
  db: NodePgDatabase<typeof schema>;
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
    db,
    ping: async () => {
      await pool.query('select 1');
    },
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => pool.end(),
  };
}
