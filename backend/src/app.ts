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
import { segmentRoutes } from './routes/segments.js';
import { sendRoutes } from './routes/sends.js';
import { webhookRoutes } from './routes/webhooks.js';
import { EventHubService } from './eventhub/service.js';
import { EventsView } from './eventhub/events-view.js';
import { eventRoutes } from './routes/events.js';
import { alertRoutes } from './routes/alerts.js';
import { privacyRoutes } from './routes/privacy.js';
import { dmarcRoutes } from './routes/dmarc.js';
import { newsletterRoutes } from './routes/newsletter.js';
import { Collectors } from './newsletter/collectors.js';
import { NewsletterService } from './newsletter/service.js';
import { IssueEditor } from './newsletter/editor.js';
import { NewsletterPublishing } from './newsletter/publishing.js';
import { Notifier } from './notify/notifier.js';
import { UploadService } from './uploads/service.js';
import { createWritingAssistant, type WritingAssistant } from './ai/writing-assistant.js';
import { DmarcService } from './dmarc/service.js';
import { PrivacyService } from './privacy/service.js';
import { AlertService } from './alerts/service.js';
import { EspEventService } from './events/service.js';
import { SendDispatcher } from './sends/dispatcher.js';
import { KillSwitch } from './sends/kill-switch.js';
import { SunsetPolicy } from './sends/sunset.js';
import { httpLinkChecker, SendService, type LinkChecker } from './sends/service.js';
import { SegmentService } from './segments/service.js';
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
import { analyticsRoutes } from './routes/analytics.js';
import { commandCenterRoutes } from './routes/command-center.js';
import { AnalyticsPipeline } from './analytics/pipeline.js';
import { ChannelTaxonomy } from './analytics/taxonomy.js';
import { LinkBuilder } from './analytics/links.js';
import { CostService } from './analytics/costs.js';
import { AttributionService } from './analytics/attribution.js';
import { OverviewService } from './analytics/overview.js';
import { DetailService } from './analytics/detail.js';
import { DataHealth } from './analytics/health.js';
import { SelfReportedService } from './analytics/self-reported.js';
import type { AnalyticsSources } from './analytics/sources/contract.js';
import { createMockAnalyticsSources } from './analytics/sources/mock.js';

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
    segments: SegmentService;
    sends: SendService;
    dispatcher: SendDispatcher;
    killSwitch: KillSwitch;
    alerts: AlertService;
    espEvents: EspEventService;
    privacy: PrivacyService;
    dmarc: DmarcService;
    sunset: SunsetPolicy;
    newsletter: NewsletterService;
    issueEditor: IssueEditor;
    publishing: NewsletterPublishing;
    uploads: UploadService;
    pipeline: AnalyticsPipeline;
    eventHub: EventHubService;
    taxonomy: ChannelTaxonomy;
    linkBuilder: LinkBuilder;
    costs: CostService;
    attribution: AttributionService;
    overview: OverviewService;
    detail: DetailService;
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
  linkChecker?: LinkChecker;
  writingAssistant?: WritingAssistant;
  /** External analytics sources (PRD 9.1); mocks by default. */
  analyticsSources?: AnalyticsSources;
  /** Tests skip the pause between batches. */
  sleep?: (ms: number) => Promise<void>;
};

export async function buildApp({
  config,
  database,
  integrations,
  email,
  dnsResolver,
  mailChecker,
  linkChecker,
  sleep,
  writingAssistant,
  analyticsSources,
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
  const killSwitch = new KillSwitch(database.db);
  app.decorate('killSwitch', killSwitch);
  app.decorate('email', guardMarketingSends(espAdapter, domains, () => killSwitch.isPaused()));
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
  const taxonomy = new ChannelTaxonomy(database.db);
  app.decorate('taxonomy', taxonomy);
  const sunset = new SunsetPolicy({ db: database.db, mailFrom: config.mailFrom });
  app.decorate('sunset', sunset);
  const signup = new SignupService({
    contacts,
    contactRepository,
    consent,
    touchpoints,
    email: app.email,
    links,
    signer,
    crm: resolvedIntegrations.navigatorCrm,
    taxonomy,
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
  await app.register(publicPreferenceRoutes, {
    consent,
    contacts: contactRepository,
    signer,
    db: database.db,
    stay: async (contactId) => {
      await touchpoints.record({ contactId, channel: 'email', campaign: 'reengagement', type: 'click', occurredAt: new Date(), sourceSystem: 'preferences', sourceRef: null });
      await sunset.reactivate(contactId);
    },
  });
  await app.register(publicSignupRoutes, { signup });
  const duplicates = new DuplicateService(database.db);
  const imports = new ImportService({ db: database.db, contacts: contactRepository, consentRepository, consent });
  const alerts = new AlertService(database.db, app.log);
  app.decorate('alerts', alerts);
  const notifier = new Notifier({
    slackWebhookUrl: config.slackWebhookUrl,
    editorEmails: config.newsletterEditorEmails,
    email: app.email,
    mail: { from: config.mailFrom, postalAddress: config.postalAddress },
    logger: app.log,
  });
  const jobs: JobRunner = new JobRunner({
    db: database.db,
    logger: app.log,
    // 14.4: every scheduled job alerts in the app on failure. ANL-11: a second failure in a row is critical
    // and also goes to Slack and the admins by email (once per streak).
    onFailure: async (job, error) => {
      const streak = await jobs.consecutiveFailures(job.name);
      if (streak < 2) {
        await alerts.raise({ level: 'warning', roles: ['admin'], title: `Job failed: ${job.description}`, message: error.message, link: '#/analytics/health', dedupeKey: `job:${job.name}` });
        return;
      }
      await alerts.raise({ level: 'critical', roles: ['admin'], title: `Failing twice in a row: ${job.description}`, message: error.message, link: '#/analytics/health', dedupeKey: `job-streak:${job.name}` });
      if (streak === 2) {
        await notifier.notify(
          { title: `Data source failing: ${job.description}`, text: `${job.name} failed twice in a row. Last error: ${error.message}`, link: `${config.publicAppUrl}/#/analytics/health` },
          { to: config.adminAlertEmails, reason: 'You receive this because you administer Marketing Hub.' },
        );
      }
    },
  });
  const sync = new SyncService({
    db: database.db,
    contacts: contactRepository,
    consent,
    coreEngine: resolvedIntegrations.coreEngine,
    crm: resolvedIntegrations.navigatorCrm,
    alumni: resolvedIntegrations.alumniTracker,
    taxonomy,
  });
  for (const job of sync.jobs()) jobs.register(job);
  app.decorate('jobs', jobs);
  app.decorate('sync', sync);
  app.addHook('onClose', async () => jobs.stop());
  await app.register(jobRoutes, { jobs, coreEngine: resolvedIntegrations.coreEngine });
  const segments = new SegmentService(database.db);
  app.decorate('segments', segments);
  await app.register(segmentRoutes, { segments, contacts, coreEngine: resolvedIntegrations.coreEngine });
  const sendService = new SendService({
    db: database.db,
    segments,
    domains,
    email: app.email,
    links,
    signer,
    linkChecker: linkChecker ?? httpLinkChecker,
    postalAddress: config.postalAddress,
  });
  const dispatcher = new SendDispatcher({
    db: database.db,
    sends: sendService,
    segments,
    consent,
    email: app.email,
    killSwitch,
    logger: app.log,
    options: { batchSize: config.sendBatchSize, ratePerSecond: config.sendRatePerSecond, tickBudgetMs: 50_000, maxAttempts: 5 },
    sleep,
  });
  app.decorate('sends', sendService);
  app.decorate('dispatcher', dispatcher);
  jobs.register({ name: 'send_dispatcher', description: 'Sends approved campaigns in batches', intervalMs: 60_000, run: () => dispatcher.tick() });
  await app.register(sendRoutes, { sends: sendService, killSwitch, seedList: config.seedList, coreEngine: resolvedIntegrations.coreEngine });
  const espEvents = new EspEventService({ db: database.db, consent, touchpoints, alerts, killSwitch, logger: app.log, onEngagement: (contactId) => sunset.reactivate(contactId) });
  jobs.register({ name: 'sunset_policy', description: 'Sunset policy: re-engagement emails and leaving regular sends', intervalMs: 24 * 60 * 60_000, run: () => sunset.run() });
  app.decorate('espEvents', espEvents);
  await app.register(alertRoutes, { alerts, db: database.db, coreEngine: resolvedIntegrations.coreEngine });
  const privacy = new PrivacyService({ db: database.db, segments, coreEngine: resolvedIntegrations.coreEngine, logger: app.log });
  app.decorate('privacy', privacy);
  await app.register(privacyRoutes, { privacy, coreEngine: resolvedIntegrations.coreEngine });
  const dmarc = new DmarcService({ db: database.db, alerts, knownSources: config.dmarcKnownSources });
  app.decorate('dmarc', dmarc);
  await app.register(dmarcRoutes, { dmarc, coreEngine: resolvedIntegrations.coreEngine });
  const collectors = new Collectors({
    db: database.db,
    coreEngine: resolvedIntegrations.coreEngine,
    alumni: resolvedIntegrations.alumniTracker,
    library: resolvedIntegrations.library,
    groupLaunchpad: resolvedIntegrations.groupLaunchpad,
  });
  const newsletter = new NewsletterService({
    db: database.db,
    collectors,
    ranking: async () => undefined,
    ctaUrl: config.admissionsUrl,
    // NWS-04: "draft ready" to Slack and the editors.
    onDraftReady: (issue) =>
      notifier.notify({
        title: `Newsletter draft ready: ${issue.subject ?? issue.edition} (${issue.language})`,
        text: `Planned for ${issue.plannedSendAt.slice(0, 10)}. Review the blocks and skipped items, then ask a marketing manager to approve.`,
        link: `${config.publicAppUrl}/#/newsletter/${issue.id}`,
      }),
  });
  const uploadService = new UploadService(database.db, config.publicApiUrl);
  const issueEditor = new IssueEditor(database.db, newsletter, writingAssistant ?? createWritingAssistant(config));
  app.decorate('issueEditor', issueEditor);
  app.decorate('uploads', uploadService);
  app.decorate('newsletter', newsletter);
  const publishing = new NewsletterPublishing({
    db: database.db,
    newsletter,
    sends: sendService,
    segments,
    domains,
    email: app.email,
    uploads: uploadService,
    linkChecker: linkChecker ?? httpLinkChecker,
    mailFrom: config.mailFrom,
  });
  app.decorate('publishing', publishing);
  jobs.register({
    name: 'newsletter_schedule',
    description: 'Newsletter: plan issues, collect items, draft, mark sent issues',
    intervalMs: 60 * 60_000,
    run: async () => {
      const result = await newsletter.tick();
      const sent = await publishing.syncSent();
      return { rowsIn: result.rowsIn, rowsUpserted: result.rowsUpserted + sent.length };
    },
  });
  await app.register(newsletterRoutes, { newsletter, editor: issueEditor, publishing, uploads: uploadService, seedList: config.seedList, coreEngine: resolvedIntegrations.coreEngine });
  const merge = new MergeService({ db: database.db, coreEngine: resolvedIntegrations.coreEngine, logger: app.log });
  const sources = analyticsSources ?? createMockAnalyticsSources();
  const pipeline = new AnalyticsPipeline({
    db: database.db,
    sources,
    mapChannel: (source, medium) => taxonomy.mapUtm(source, medium, 'website_analytics'),
  });
  app.decorate('pipeline', pipeline);
  for (const job of pipeline.jobs()) jobs.register(job);
  const linkBuilder = new LinkBuilder(database.db, taxonomy, config.publicApiUrl);
  app.decorate('linkBuilder', linkBuilder);
  const costs = new CostService(database.db, sources.rates);
  const eventHub = new EventHubService({ db: database.db, contacts, contactRepository, consent, touchpoints, taxonomy, costs, logger: app.log });
  app.decorate('eventHub', eventHub);
  await app.register(eventRoutes, { view: new EventsView(database.db), coreEngine: resolvedIntegrations.coreEngine });
  await app.register(webhookRoutes, { events: espEvents, secret: config.espWebhookSecret, eventHub, eventHubSecret: config.eventHubWebhookSecret });
  app.decorate('costs', costs);
  const attribution = new AttributionService(database.db);
  app.decorate('attribution', attribution);
  const overview = new OverviewService({ db: database.db, attribution, costs });
  app.decorate('overview', overview);
  const detail = new DetailService({ db: database.db, attribution, costs });
  app.decorate('detail', detail);
  await app.register(analyticsRoutes, { pipeline, taxonomy, links: linkBuilder, costs, attribution, overview, detail, health: new DataHealth({ jobs, pipeline, taxonomy }),
    selfReported: new SelfReportedService({ db: database.db, attribution }),
    coreEngine: resolvedIntegrations.coreEngine });
  await app.register(commandCenterRoutes, { overview, detail, apiKey: config.commandCenterApiKey });
  await app.register(importRoutes, { imports, duplicates, merge, contacts, contactRepository, coreEngine: resolvedIntegrations.coreEngine });

  return app;
}
