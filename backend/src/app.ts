import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config/env.js';
import type { Database } from './db/client.js';
import { createEmailAdapter, type EmailAdapter } from './email/index.js';
import { createIntegrations, type Integrations } from './integrations/index.js';
import { healthRoutes } from './routes/health.js';

export type AppDeps = {
  config: AppConfig;
  database?: Database;
  integrations?: Integrations;
  email?: EmailAdapter;
};

export async function buildApp({ config, database, integrations, email }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
      // Never log credentials or tokens (NFR-S3).
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
    },
    // Render terminates TLS in front of the service.
    trustProxy: true,
    // Structured logs with request IDs (PRD 14.4).
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    bodyLimit: 1_048_576,
  });

  const allowedOrigins = new Set(config.corsOrigins.map((origin) => origin.replace(/\/+$/, '')));

  await app.register(helmet);
  await app.register(cors, {
    // Exact allowlist from CORS_ORIGINS; requests from other origins get no CORS headers.
    origin: (origin, callback) => {
      callback(null, origin !== undefined && allowedOrigins.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  const resolvedEmail = email ?? createEmailAdapter(config.emailAdapter, app.log);
  const resolvedIntegrations = integrations ?? createIntegrations(config.integrationsMode);

  await app.register(healthRoutes, {
    database,
    integrations: resolvedIntegrations,
    email: resolvedEmail,
  });

  return app;
}
