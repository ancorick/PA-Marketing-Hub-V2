import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDatabase } from './db/client.js';

const config = loadConfig();
const database = config.databaseUrl ? createDatabase(config.databaseUrl) : undefined;
// Render free has no pre-deploy step, so pending migrations run on boot (drizzle tracks applied ones).
await database?.migrate();
const app = await buildApp({ config, database });

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
