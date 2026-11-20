import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client.js';
import type { EmailAdapter } from '../email/index.js';
import type { Integrations } from '../integrations/index.js';

type HealthDeps = {
  database: Database | undefined;
  integrations: Integrations;
  email: EmailAdapter;
};

/**
 * Liveness + dependency status. Always answers 200 so Render does not restart the service
 * when only the database is down; "status" tells whether everything is reachable.
 */
export async function healthRoutes(app: FastifyInstance, deps: HealthDeps) {
  app.get('/api/health', async () => {
    let database: 'ok' | 'unavailable' | 'not_configured' = 'not_configured';
    if (deps.database) {
      try {
        await deps.database.ping();
        database = 'ok';
      } catch (error) {
        app.log.warn({ err: error }, 'database ping failed');
        database = 'unavailable';
      }
    }
    return {
      status: database === 'unavailable' ? 'degraded' : 'ok',
      service: 'marketing-hub-api',
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      database,
      email: { adapter: deps.email.name },
      integrations: {
        mode: deps.integrations.mode,
        coreEngine: deps.integrations.coreEngine.contractVersion,
        navigatorCrm: deps.integrations.navigatorCrm.contractVersion,
        alumniTracker: deps.integrations.alumniTracker.contractVersion,
      },
    };
  });
}
