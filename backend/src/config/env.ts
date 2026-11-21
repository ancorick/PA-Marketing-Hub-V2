import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: csv.pipe(z.array(z.url())),
  DATABASE_URL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined)),
  EMAIL_ADAPTER: z.enum(['log']).default('log'),
  INTEGRATIONS_MODE: z.enum(['mock']).default('mock'),
  ANALYTICS_SOURCES_MODE: z.enum(['mock']).default('mock'),
  // rua= address in the DMARC record (PRD 7.2); defaults to dmarc-reports@<sending domain>.
  DMARC_REPORT_EMAIL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined))
    .pipe(z.email().optional()),
  // Accept the public "mock-<role>" staff tokens. Default: on, except NODE_ENV=production.
  ALLOW_MOCK_SIGN_IN: z.enum(['true', 'false']).optional(),
  // How old a "verified" verdict may be before a marketing send re-checks DNS live (EML-03).
  DOMAIN_RECHECK_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  // HMAC key for unsubscribe, preferences and confirmation links (NFR-S5). Required in production.
  LINK_SIGNING_SECRET: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined))
    .pipe(z.string().min(32, 'must be at least 32 characters').optional()),
  // Where people open public pages (frontend) and where mail clients POST one-click unsubscribes (backend).
  PUBLIC_APP_URL: z.url().default('http://localhost:5173'),
  PUBLIC_API_URL: z.url().default('http://localhost:4000'),
  // Sender of marketing and confirmation email (PRD 7.1: a named, monitored address on the sending subdomain).
  MAIL_FROM: z.string().min(3).default('Picsart Academy <news@news.academy-domain.invalid>'),
  // Physical address in every marketing email footer (EML-11, NFR-P3).
  // Sending IPs (or IPv4 CIDR ranges) of the ESP and other services allowed to send for the domain (EML-07).
  // DMARC failures from anything else count as unknown sources and alert the admin.
  DMARC_KNOWN_SOURCES: z.string().default(''),
  // Where the newsletter call to action sends readers (admissions page). Empty: the block has no button.
  ADMISSIONS_URL: z.string().optional().transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined)).pipe(z.url().optional()),
  // NWS-04: Slack incoming webhook for "draft ready" (a secret) and editor emails, comma-separated.
  SLACK_WEBHOOK_URL: z.string().optional().transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined)).pipe(z.url().optional()),
  NEWSLETTER_EDITOR_EMAILS: z.string().default(''),
  // NWS-07 AI writing assist (Claude API). Empty key: the feature is off.
  ANTHROPIC_API_KEY: z.string().optional().transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined)),
  AI_MODEL: z.string().min(3).default('claude-opus-5-5'),
  // Shared secret for ESP webhook signatures (EML-04, NFR-S4); the real ESP adapter may use its own scheme.
  ESP_WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined))
    .pipe(z.string().min(32, 'must be at least 32 characters').optional()),
  // Scheduled jobs (sync, sends, pipelines). Default on; off in tests, which run jobs directly.
  JOBS_ENABLED: z.enum(['true', 'false']).optional(),
  // Sending pace (EML-09): stay under the ESP's per-second limit; 10,000 emails in < 30 min needs ≥ 6/s (NFR-F3).
  SEND_RATE_PER_SECOND: z.coerce.number().min(0.1).max(1000).default(14),
  SEND_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  // Seed list for test sends (EML-13): staff inboxes on Gmail, Outlook, Apple Mail, comma-separated.
  SEED_LIST: z.string().default(''),
  ACADEMY_POSTAL_ADDRESS: z.string().min(3).default('Picsart Academy, address to be confirmed, Yerevan, Armenia'),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  corsOrigins: string[];
  databaseUrl: string | undefined;
  emailAdapter: 'log';
  integrationsMode: 'mock';
  /** Website analytics, social and ad platform clients (PRD 9.1); real ones need manual task 3. */
  analyticsSourcesMode: 'mock';
  dmarcReportEmail: string | undefined;
  domainRecheckMinutes: number;
  /** Mock sign-in with fixed tokens; never on in production unless explicitly enabled. */
  allowMockSignIn: boolean;
  linkSigningSecret: string;
  publicAppUrl: string;
  publicApiUrl: string;
  mailFrom: string;
  postalAddress: string;
  jobsEnabled: boolean;
  sendRatePerSecond: number;
  sendBatchSize: number;
  seedList: string[];
  /** null in production without a secret: the webhook endpoint answers 503 instead of trusting anyone. */
  espWebhookSecret: string | null;
  dmarcKnownSources: string[];
  admissionsUrl: string | null;
  slackWebhookUrl: string | null;
  anthropicApiKey: string | null;
  aiModel: string;
  newsletterEditorEmails: string[];
};

/** Development only: links signed with it stop working on any real deploy, where the secret is required. */
const DEV_LINK_SECRET = 'development-only-link-signing-secret-not-for-production';

/** Reads and validates configuration; fails fast with a readable message on bad values. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && !env.LINK_SIGNING_SECRET) {
    throw new Error('Invalid environment configuration: LINK_SIGNING_SECRET is required in production (NFR-S5)');
  }
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    corsOrigins: env.CORS_ORIGINS,
    databaseUrl: env.DATABASE_URL,
    emailAdapter: env.EMAIL_ADAPTER,
    integrationsMode: env.INTEGRATIONS_MODE,
    analyticsSourcesMode: env.ANALYTICS_SOURCES_MODE,
    dmarcReportEmail: env.DMARC_REPORT_EMAIL,
    domainRecheckMinutes: env.DOMAIN_RECHECK_MINUTES,
    allowMockSignIn:
      env.INTEGRATIONS_MODE === 'mock' &&
      (env.ALLOW_MOCK_SIGN_IN === undefined ? env.NODE_ENV !== 'production' : env.ALLOW_MOCK_SIGN_IN === 'true'),
    linkSigningSecret: env.LINK_SIGNING_SECRET ?? DEV_LINK_SECRET,
    publicAppUrl: env.PUBLIC_APP_URL.replace(/\/+$/, ''),
    publicApiUrl: env.PUBLIC_API_URL.replace(/\/+$/, ''),
    mailFrom: env.MAIL_FROM,
    postalAddress: env.ACADEMY_POSTAL_ADDRESS,
    sendRatePerSecond: env.SEND_RATE_PER_SECOND,
    sendBatchSize: env.SEND_BATCH_SIZE,
    espWebhookSecret: env.ESP_WEBHOOK_SECRET ?? (env.NODE_ENV === 'production' ? null : 'development-only-esp-webhook-secret-0123456789'),
    admissionsUrl: env.ADMISSIONS_URL ?? null,
    slackWebhookUrl: env.SLACK_WEBHOOK_URL ?? null,
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
    aiModel: env.AI_MODEL,
    newsletterEditorEmails: env.NEWSLETTER_EDITOR_EMAILS.split(',').map((item) => item.trim()).filter((item) => item.includes('@')),
    dmarcKnownSources: env.DMARC_KNOWN_SOURCES.split(',').map((item) => item.trim()).filter(Boolean),
    seedList: env.SEED_LIST.split(',').map((item) => item.trim()).filter((item) => item.includes('@')),
    jobsEnabled: env.JOBS_ENABLED === undefined ? env.NODE_ENV !== 'test' : env.JOBS_ENABLED === 'true',
  };
}
