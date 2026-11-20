import { buildApp, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createEmbeddedDatabase, truncateAll, type Database } from '../src/db/client.js';
import type { DnsResolver } from '../src/domains/verify.js';

export const FRONTEND_ORIGIN = 'http://localhost:5173';
export const TEST_LINK_SECRET = 'test-link-signing-secret-0123456789abcdef';

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({ NODE_ENV: 'test', CORS_ORIGINS: FRONTEND_ORIGIN, LINK_SIGNING_SECRET: TEST_LINK_SECRET, ...overrides });
}

let shared: Promise<Database> | undefined;

/**
 * One migrated in-process Postgres per test file (vitest isolates files), emptied before each use,
 * so every test starts from a clean database without paying for migrations again.
 */
export async function testDatabase(): Promise<Database> {
  shared ??= createEmbeddedDatabase().then(async (database) => {
    await database.migrate();
    return database;
  });
  const database = await shared;
  await truncateAll(database);
  return database;
}

/** Tests never touch public DNS: the resolver defaults to an empty fake zone. */
export async function buildTestApp(options: Partial<Omit<AppDeps, 'config'>> & { config?: AppDeps['config'] } = {}) {
  return buildApp({ config: testConfig(), dnsResolver: new FakeDns(), ...options, database: options.database ?? (await testDatabase()) });
}

const dnsError = (code: string) => Object.assign(new Error(`queryTxt ${code}`), { code });

/** In-memory DNS zone. Hosts are matched case-insensitively, like real DNS. */
export class FakeDns implements DnsResolver {
  readonly txt = new Map<string, string[]>();
  readonly cname = new Map<string, string[]>();
  /** Hosts whose lookups time out. */
  readonly failing = new Set<string>();

  setTxt(host: string, ...values: string[]) {
    this.txt.set(host.toLowerCase(), values);
    return this;
  }

  setCname(host: string, target: string) {
    this.cname.set(host.toLowerCase(), [target]);
    return this;
  }

  clear() {
    this.txt.clear();
    this.cname.clear();
  }

  async resolveTxt(host: string) {
    if (this.failing.has(host.toLowerCase())) throw dnsError('ETIMEOUT');
    const values = this.txt.get(host.toLowerCase());
    if (!values) throw dnsError('ENOTFOUND');
    return values.map((value) => [value]);
  }

  async resolveCname(host: string) {
    if (this.failing.has(host.toLowerCase())) throw dnsError('ETIMEOUT');
    const values = this.cname.get(host.toLowerCase());
    if (!values) throw dnsError('ENODATA');
    return values;
  }
}

/** Publishes what the log adapter's placeholder ESP identity asks for. */
export function publishPlaceholderRecords(dns: FakeDns, domain: string) {
  dns
    .setTxt(domain, 'v=spf1 include:spf.esp-not-chosen.invalid -all')
    .setCname(`mh1._domainkey.${domain}`, 'mh1.dkim.esp-not-chosen.invalid')
    .setTxt(`_dmarc.${domain}`, `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}`)
    .setCname(`click.${domain}`, 'track.esp-not-chosen.invalid.');
}

export const bearer = (role: string) => ({ authorization: `Bearer mock-${role}` });
