import { createPublicKey } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import type { DmarcPolicy, DnsCheckResult, DnsRecordKind, ExpectedRecord, RecordCheck } from './types.js';

/** The two lookups the checks need; `node:dns/promises` Resolver fits, tests pass a fake. */
export interface DnsResolver {
  resolveTxt(host: string): Promise<string[][]>;
  resolveCname(host: string): Promise<string[]>;
}

export function createDnsResolver(): DnsResolver {
  // Bounded so a slow DNS server cannot hang the setup screen or a send.
  return new Resolver({ timeout: 3_000, tries: 2 });
}

/** RFC 7208 §4.6.4: more than 10 DNS-querying terms make SPF fail with permerror (PRD 7.2). */
export const SPF_LOOKUP_LIMIT = 10;
/** PRD 7.2: DKIM keys are at least 2048 bits. */
export const DKIM_MIN_RSA_BITS = 2048;

type Lookup = { kind: 'found'; values: string[] } | { kind: 'missing' } | { kind: 'error'; message: string };

const NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA', 'ENONAME']);

async function lookup(run: () => Promise<string[]>): Promise<Lookup> {
  try {
    const values = await run();
    return values.length > 0 ? { kind: 'found', values } : { kind: 'missing' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (NOT_FOUND_CODES.has(code)) return { kind: 'missing' };
    return { kind: 'error', message: `DNS lookup failed (${code || 'unknown error'}); try again in a minute` };
  }
}

// A TXT record may be split into 255-byte strings; receivers join them without separators.
const lookupTxt = (resolver: DnsResolver, host: string) =>
  lookup(async () => (await resolver.resolveTxt(host)).map((chunks) => chunks.join('')));

const lookupCname = (resolver: DnsResolver, host: string) => lookup(() => resolver.resolveCname(host));

const normalizeHost = (host: string) => host.trim().toLowerCase().replace(/\.$/, '');

/** Parses "k=v; k=v" tag lists (DKIM, DMARC). Tag names are case-insensitive. */
function parseTags(record: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of record.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    tags.set(part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim());
  }
  return tags;
}

function result(
  record: ExpectedRecord,
  found: string[],
  problems: string[],
  status?: RecordCheck['status'],
): RecordCheck {
  return {
    kind: record.kind,
    host: record.host,
    status: status ?? (problems.length === 0 ? 'verified' : 'invalid'),
    found,
    problems,
  };
}

function notPublished(record: ExpectedRecord, outcome: Exclude<Lookup, { kind: 'found' }>): RecordCheck {
  return outcome.kind === 'missing'
    ? result(record, [], [`No ${record.type} record at ${record.host} yet`], 'missing')
    : result(record, [], [outcome.message], 'error');
}

const isSpf = (value: string) => /^v=spf1(\s|$)/i.test(value.trim());

/**
 * Counts DNS-querying SPF terms, following include: and redirect= (RFC 7208 §4.6.4).
 * Stops as soon as the limit is passed; unresolvable nested records count only their own lookup.
 */
async function countSpfLookups(resolver: DnsResolver, record: string, budget = { used: 0 }, depth = 0): Promise<number> {
  for (const term of record.trim().split(/\s+/).slice(1)) {
    const mechanism = term.replace(/^[+\-~?]/, '').toLowerCase();
    const name = mechanism.split(/[:=/]/)[0];
    if (!['include', 'a', 'mx', 'ptr', 'exists', 'redirect'].includes(name ?? '')) continue;
    budget.used += 1;
    if (budget.used > SPF_LOOKUP_LIMIT || depth >= SPF_LOOKUP_LIMIT) return budget.used;
    if (name === 'include' || name === 'redirect') {
      const target = mechanism.slice(name.length + 1);
      const nested = await lookupTxt(resolver, target);
      const nestedSpf = nested.kind === 'found' ? nested.values.find(isSpf) : undefined;
      if (nestedSpf) await countSpfLookups(resolver, nestedSpf, budget, depth + 1);
    }
  }
  return budget.used;
}

async function checkSpf(resolver: DnsResolver, record: ExpectedRecord, spfInclude: string): Promise<RecordCheck> {
  const outcome = await lookupTxt(resolver, record.host);
  if (outcome.kind !== 'found') return notPublished(record, outcome);
  const found = outcome.values.filter(isSpf);
  if (found.length === 0) return notPublished(record, { kind: 'missing' });
  if (found.length > 1) {
    return result(record, found, ['More than one SPF record: receivers reject both. Merge them into one record']);
  }

  const spf = found[0] as string;
  const terms = spf.trim().toLowerCase().split(/\s+/);
  const problems: string[] = [];
  const include = spfInclude.toLowerCase();
  // `redirect=` to the ESP's record authorizes it just like `include:`.
  if (!terms.some((term) => term.replace(/^\+/, '') === `include:${include}` || term === `redirect=${include}`)) {
    problems.push(`Does not authorize the email service: add include:${spfInclude}`);
  }
  const all = terms.find((term) => /^[+\-~?]?all$/.test(term));
  if (!all && !terms.some((term) => term.startsWith('redirect='))) {
    problems.push('Must end with -all (or ~all) so other servers cannot send as this domain');
  } else if (all && !['-all', '~all'].includes(all)) {
    problems.push(`"${all}" lets any server send as this domain: end the record with -all`);
  }
  const lookups = await countSpfLookups(resolver, spf);
  if (lookups > SPF_LOOKUP_LIMIT) {
    problems.push(`Needs more than ${SPF_LOOKUP_LIMIT} DNS lookups, so receivers treat it as broken: remove includes`);
  }
  return result(record, found, problems);
}

/** RSA modulus length of a base64 DKIM public key, or null when it cannot be read. */
function rsaKeyBits(base64: string): number | null {
  try {
    const key = createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });
    return key.asymmetricKeyDetails?.modulusLength ?? null;
  } catch {
    return null;
  }
}

/** Checks the key published at the selector (CNAMEs are followed by the resolver). */
async function dkimKeyProblems(resolver: DnsResolver, host: string): Promise<{ found: string[]; problems: string[] }> {
  const outcome = await lookupTxt(resolver, host);
  if (outcome.kind !== 'found') {
    // CNAME records point to the ESP; a key that is not resolvable yet is the ESP's to publish.
    return { found: [], problems: [] };
  }
  const dkim = outcome.values.find((value) => /(^|;)\s*p=/i.test(value));
  if (!dkim) return { found: outcome.values, problems: ['No DKIM key (p=) at this host'] };
  const tags = parseTags(dkim);
  const key = (tags.get('p') ?? '').replace(/\s+/g, '');
  if (key === '') return { found: [dkim], problems: ['The DKIM key is revoked (empty p=)'] };
  if ((tags.get('k') ?? 'rsa').toLowerCase() !== 'rsa') return { found: [dkim], problems: [] };
  const bits = rsaKeyBits(key);
  if (bits === null) return { found: [dkim], problems: ['The DKIM key cannot be read: check it was copied in full'] };
  if (bits < DKIM_MIN_RSA_BITS) {
    return { found: [dkim], problems: [`The DKIM key is ${bits} bits; use a ${DKIM_MIN_RSA_BITS}-bit key`] };
  }
  return { found: [dkim], problems: [] };
}

async function checkDkim(resolver: DnsResolver, record: ExpectedRecord): Promise<RecordCheck> {
  if (record.type === 'CNAME') {
    const outcome = await lookupCname(resolver, record.host);
    if (outcome.kind !== 'found') return notPublished(record, outcome);
    if (!outcome.values.some((value) => normalizeHost(value) === normalizeHost(record.value))) {
      return result(record, outcome.values, [`Points to ${outcome.values.join(', ')}; must point to ${record.value}`]);
    }
    const key = await dkimKeyProblems(resolver, record.host);
    return result(record, outcome.values, key.problems);
  }

  const outcome = await lookupTxt(resolver, record.host);
  if (outcome.kind !== 'found') return notPublished(record, outcome);
  const expectedKey = (parseTags(record.value).get('p') ?? '').replace(/\s+/g, '');
  const published = outcome.values.filter((value) => /(^|;)\s*p=/i.test(value));
  const matches = published.some((value) => (parseTags(value).get('p') ?? '').replace(/\s+/g, '') === expectedKey);
  if (!matches) return result(record, outcome.values, ['The published key differs from the one the email service signs with']);
  const key = await dkimKeyProblems(resolver, record.host);
  return result(record, published, key.problems);
}

const DMARC_POLICIES: readonly DmarcPolicy[] = ['none', 'quarantine', 'reject'];

async function checkDmarc(
  resolver: DnsResolver,
  record: ExpectedRecord,
): Promise<{ check: RecordCheck; policy: DmarcPolicy | null }> {
  const outcome = await lookupTxt(resolver, record.host);
  if (outcome.kind !== 'found') return { check: notPublished(record, outcome), policy: null };
  const found = outcome.values.filter((value) => /^v=DMARC1\s*(;|$)/i.test(value.trim()));
  if (found.length === 0) return { check: notPublished(record, { kind: 'missing' }), policy: null };
  if (found.length > 1) {
    return { check: result(record, found, ['More than one DMARC record: receivers ignore both. Keep one']), policy: null };
  }

  const tags = parseTags(found[0] as string);
  const rawPolicy = (tags.get('p') ?? '').toLowerCase();
  const policy = DMARC_POLICIES.find((candidate) => candidate === rawPolicy) ?? null;
  const problems: string[] = [];
  if (!policy) problems.push('Policy p= must be none, quarantine or reject');
  if (!/mailto:/i.test(tags.get('rua') ?? '')) {
    problems.push('Add rua=mailto:… so aggregate reports arrive (needed for the authentication pass rate)');
  }
  return { check: result(record, found, problems), policy };
}

async function checkTracking(resolver: DnsResolver, record: ExpectedRecord): Promise<RecordCheck> {
  const outcome = await lookupCname(resolver, record.host);
  if (outcome.kind !== 'found') return notPublished(record, outcome);
  if (!outcome.values.some((value) => normalizeHost(value) === normalizeHost(record.value))) {
    return result(record, outcome.values, [`Points to ${outcome.values.join(', ')}; must point to ${record.value}`]);
  }
  return result(record, outcome.values, []);
}

/** Live check of every expected record against public DNS (EML-02). Lookups run in parallel. */
export async function checkDomainRecords(
  resolver: DnsResolver,
  records: ExpectedRecord[],
  spfInclude: string,
  now: Date = new Date(),
): Promise<DnsCheckResult> {
  let dmarcPolicy: DmarcPolicy | null = null;
  const checks = await Promise.all(
    records.map(async (record) => {
      switch (record.kind) {
        case 'spf':
          return checkSpf(resolver, record, spfInclude);
        case 'dkim':
          return checkDkim(resolver, record);
        case 'dmarc': {
          const { check, policy } = await checkDmarc(resolver, record);
          dmarcPolicy = policy;
          return check;
        }
        case 'tracking':
          return checkTracking(resolver, record);
      }
    }),
  );
  return { checkedAt: now.toISOString(), records: checks, dmarcPolicy };
}

/** One status per mechanism: verified only when every record of that kind is verified. */
export function statusOf(check: DnsCheckResult, kind: DnsRecordKind): RecordCheck['status'] {
  const ofKind = check.records.filter((record) => record.kind === kind);
  if (ofKind.length === 0) return 'missing';
  return ofKind.find((record) => record.status !== 'verified')?.status ?? 'verified';
}
