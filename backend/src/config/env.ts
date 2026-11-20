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
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  corsOrigins: string[];
  databaseUrl: string | undefined;
  emailAdapter: 'log';
  integrationsMode: 'mock';
  dmarcReportEmail: string | undefined;
  domainRecheckMinutes: number;
  /** Mock sign-in with fixed tokens; never on in production unless explicitly enabled. */
  allowMockSignIn: boolean;
  linkSigningSecret: string;
  publicAppUrl: string;
  publicApiUrl: string;
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
    dmarcReportEmail: env.DMARC_REPORT_EMAIL,
    domainRecheckMinutes: env.DOMAIN_RECHECK_MINUTES,
    allowMockSignIn:
      env.INTEGRATIONS_MODE === 'mock' &&
      (env.ALLOW_MOCK_SIGN_IN === undefined ? env.NODE_ENV !== 'production' : env.ALLOW_MOCK_SIGN_IN === 'true'),
    linkSigningSecret: env.LINK_SIGNING_SECRET ?? DEV_LINK_SECRET,
    publicAppUrl: env.PUBLIC_APP_URL.replace(/\/+$/, ''),
    publicApiUrl: env.PUBLIC_API_URL.replace(/\/+$/, ''),
  };
}
