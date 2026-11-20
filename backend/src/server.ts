import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDatabase } from './db/client.js';

const config = loadConfig();
const database = config.databaseUrl ? createDatabase(config.databaseUrl) : undefined;
const app = await buildApp({ config, database });

/**
 * Render free has no pre-deploy step, so pending migrations run on boot (drizzle tracks applied ones).
 * A cold or unreachable database must not crash the service: /api/health reports "degraded" while
 * failed migrations retry in the background with backoff (30 s doubling to 5 min).
 */
async function migrate(delayMs = 30_000): Promise<void> {
  if (!database) return;
  try {
    await database.migrate();
    app.log.info('database migrations applied');
  } catch (error) {
    app.log.error({ err: error, retryInMs: delayMs }, 'database migrations failed; retrying');
    setTimeout(() => void migrate(Math.min(delayMs * 2, 300_000)), delayMs).unref();
  }
}
// The first attempt runs before listening, so requests never meet a half-migrated schema.
await migrate();

if (!database) app.log.warn('DATABASE_URL is not set: running without a database');
if (config.integrationsMode === 'mock') {
  app.log.warn('INTEGRATIONS_MODE=mock: Core Engine, Navigator CRM and Alumni Tracker are stubs');
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database?.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  // Render provides PORT and needs the service bound to 0.0.0.0.
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
