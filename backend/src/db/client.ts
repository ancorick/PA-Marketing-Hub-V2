import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = {
  db: NodePgDatabase<typeof schema>;
  /** Round-trip to Postgres; used by the health check. */
  ping: () => Promise<void>;
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
    close: () => pool.end(),
  };
}
