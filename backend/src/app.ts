import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerStaffAuth } from './auth/staff.js';
import type { AppConfig } from './config/env.js';
import type { Database } from './db/client.js';
import { ConsentRepository } from './consent/repository.js';
import { ConsentService } from './consent/service.js';
import { DrizzleContactRepository } from './contacts/repository.js';
import { ContactService } from './contacts/service.js';
import { DrizzleDomainRepository } from './domains/repository.js';
import { guardMarketingSends } from './domains/send-gate.js';
import { DomainService } from './domains/service.js';
import { createDnsResolver, type DnsResolver } from './domains/verify.js';
import { createEmailAdapter, type EmailAdapter } from './email/index.js';
import { createIntegrations, type Integrations } from './integrations/index.js';
import { ContactLinks, LinkSigner } from './links/tokens.js';
import { consentRoutes } from './routes/consent.js';
import { jobRoutes } from './routes/jobs.js';
import { JobRunner } from './jobs/runner.js';
import { SyncService } from './sync/service.js';
import { importRoutes } from './routes/imports.js';
import { ImportService } from './imports/service.js';
import { DuplicateService } from './contacts/duplicates.js';
import { MergeService } from './contacts/merge.js';
import { publicPreferenceRoutes } from './routes/public-preferences.js';
import { publicSignupRoutes } from './routes/public-signup.js';
import { SignupService } from './signup/service.js';
import { TouchpointRepository } from './touchpoints/repository.js';
import { createMailDomainChecker, type MailDomainChecker } from './contacts/address-check.js';
import { contactRoutes } from './routes/contacts.js';
import { domainRoutes } from './routes/domains.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The only way to send email: marketing sends are blocked from unverified domains (EML-03). */
    email: EmailAdapter;
    domains: DomainService;
    contacts: ContactService;
    consent: ConsentService;
    /** Signed unsubscribe, preferences and confirmation links (NFR-S5). */
    links: ContactLinks;
    signer: LinkSigner;
    touchpoints: TouchpointRepository;
    signup: SignupService;
    /** Scheduled jobs; server.ts starts the timers when JOBS_ENABLED. */
    jobs: JobRunner;
    sync: SyncService;
  }
}

export type AppDeps = {
  config: AppConfig;
  /** Neon Postgres, or the embedded PGlite when DATABASE_URL is not set (and in tests). */
  database: Database;
  integrations?: Integrations;
  email?: EmailAdapter;
  /** Overrides for tests; by default public DNS. */
  dnsResolver?: DnsResolver;
  mailChecker?: MailDomainChecker;
};

export async function buildApp({
  config,
  database,
  integrations,
  email,
  dnsResolver,
  mailChecker,
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

  const domains = new DomainService({
    repository: new DrizzleDomainRepository(database.db),
    resolver: dnsResolver ?? createDnsResolver(),
    email: espAdapter,
    logger: app.log,
    coreEngine: resolvedIntegrations.coreEngine,
    dmarcReportEmail: config.dmarcReportEmail,
    recheckAfterMs: config.domainRecheckMinutes * 60_000,
  });
  app.decorate('domains', domains);
  app.decorate('email', guardMarketingSends(espAdapter, domains));
  const contactRepository = new DrizzleContactRepository(database.db);
  const consentRepository = new ConsentRepository(database.db);
  const consent = new ConsentService({
    consent: consentRepository,
    contacts: contactRepository,
    coreEngine: resolvedIntegrations.coreEngine,
    logger: app.log,
  });
  const contacts = new ContactService({
    repository: contactRepository,
    coreEngine: resolvedIntegrations.coreEngine,
    logger: app.log,
    statusForEmail: (email) => consent.statusForEmail(email),
  });
  app.decorate('contacts', contacts);
  app.decorate('consent', consent);
  const signer = new LinkSigner(config.linkSigningSecret);
  app.decorate('signer', signer);
  const links = new ContactLinks(signer, { app: config.publicAppUrl, api: config.publicApiUrl });
  app.decorate('links', links);
  const touchpoints = new TouchpointRepository(database.db);
  app.decorate('touchpoints', touchpoints);
  const signup = new SignupService({
    contacts,
    contactRepository,
    consent,
    touchpoints,
    email: app.email,
    links,
    signer,
    crm: resolvedIntegrations.navigatorCrm,
    mailChecker: mailChecker ?? createMailDomainChecker(),
    mail: { from: config.mailFrom, postalAddress: config.postalAddress },
    logger: app.log,
  });
  app.decorate('signup', signup);
  registerStaffAuth(app);

  await app.register(healthRoutes, {
    database,
    integrations: resolvedIntegrations,
    email: app.email,
  });
  await app.register(domainRoutes, { domains, coreEngine: resolvedIntegrations.coreEngine });
  await app.register(contactRoutes, { contacts, coreEngine: resolvedIntegrations.coreEngine });
  await app.register(consentRoutes, { consent, coreEngine: resolvedIntegrations.coreEngine });
  await app.register(publicPreferenceRoutes, { consent, contacts: contactRepository, signer });
  await app.register(publicSignupRoutes, { signup });
  const duplicates = new DuplicateService(database.db);
  const imports = new ImportService({ db: database.db, contacts: contactRepository, consentRepository, consent });
  const jobs = new JobRunner({ db: database.db, logger: app.log });
  const sync = new SyncService({
    db: database.db,
    contacts: contactRepository,
    consent,
    coreEngine: resolvedIntegrations.coreEngine,
    crm: resolvedIntegrations.navigatorCrm,
    alumni: resolvedIntegrations.alumniTracker,
  });
  for (const job of sync.jobs()) jobs.register(job);
  app.decorate('jobs', jobs);
  app.decorate('sync', sync);
  app.addHook('onClose', async () => jobs.stop());
  await app.register(jobRoutes, { jobs, coreEngine: resolvedIntegrations.coreEngine });
  const merge = new MergeService({ db: database.db, coreEngine: resolvedIntegrations.coreEngine, logger: app.log });
  await app.register(importRoutes, { imports, duplicates, merge, contacts, contactRepository, coreEngine: resolvedIntegrations.coreEngine });

  return app;
}
