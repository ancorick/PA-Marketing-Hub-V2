import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerStaffAuth } from './auth/staff.js';
import type { AppConfig } from './config/env.js';
import type { Database } from './db/client.js';
import { DrizzleDomainRepository, InMemoryDomainRepository, type DomainRepository } from './domains/repository.js';
import { guardMarketingSends } from './domains/send-gate.js';
import { DomainService } from './domains/service.js';
import { createDnsResolver, type DnsResolver } from './domains/verify.js';
import { createEmailAdapter, type EmailAdapter } from './email/index.js';
import { createIntegrations, type Integrations } from './integrations/index.js';
import { domainRoutes } from './routes/domains.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The only way to send email: marketing sends are blocked from unverified domains (EML-03). */
    email: EmailAdapter;
    domains: DomainService;
  }
}

export type AppDeps = {
  config: AppConfig;
  database?: Database;
  integrations?: Integrations;
  email?: EmailAdapter;
  /** Overrides for tests; by default chosen from `database` and public DNS. */
  domainRepository?: DomainRepository;
  dnsResolver?: DnsResolver;
};

export async function buildApp({
  config,
  database,
  integrations,
  email,
  domainRepository,
  dnsResolver,
}: AppDeps): Promise<FastifyInstance> {
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

  const espAdapter = email ?? createEmailAdapter(config.emailAdapter, app.log);
  const resolvedIntegrations =
    integrations ?? createIntegrations(config.integrationsMode, { allowMockSignIn: config.allowMockSignIn });

  // Without DATABASE_URL (local work) domains live in memory until restart.
  const domains = new DomainService({
    repository: domainRepository ?? (database ? new DrizzleDomainRepository(database.db) : new InMemoryDomainRepository()),
    resolver: dnsResolver ?? createDnsResolver(),
    email: espAdapter,
    logger: app.log,
    coreEngine: resolvedIntegrations.coreEngine,
    dmarcReportEmail: config.dmarcReportEmail,
    recheckAfterMs: config.domainRecheckMinutes * 60_000,
  });
  app.decorate('domains', domains);
  app.decorate('email', guardMarketingSends(espAdapter, domains));
  registerStaffAuth(app);

  await app.register(healthRoutes, {
    database,
    integrations: resolvedIntegrations,
    email: app.email,
  });
  await app.register(domainRoutes, { domains, coreEngine: resolvedIntegrations.coreEngine });

  return app;
}
