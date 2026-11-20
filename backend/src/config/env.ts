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
  // How old a "verified" verdict may be before a marketing send re-checks DNS live (EML-03).
  DOMAIN_RECHECK_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
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
};

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
  };
}
