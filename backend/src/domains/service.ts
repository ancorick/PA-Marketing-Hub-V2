import type { EmailAdapter } from '../email/index.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import { expectedRecords } from './records.js';
import type { DomainRepository, SendingDomain } from './repository.js';
import type { CheckStatus, DmarcPolicy, DnsRecordKind, DnsRecordType, RecordCheck } from './types.js';
import { checkDomainRecords, statusOf, type DnsResolver } from './verify.js';

export class InvalidDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDomainError';
  }
}

/** Host name rules (RFC 1123): 2+ labels of letters, digits and inner hyphens, a letter TLD, 253 chars max. */
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(input: string): string {
  const domain = input.trim().toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME.test(domain)) {
    throw new InvalidDomainError('Enter a domain name such as news.academy-domain.am, without http:// or an email address');
  }
  return domain;
}

/** Domain part of a From header: "Academy <news@news.example.am>" → news.example.am. */
export function fromDomain(from: string): string | null {
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  const at = address.lastIndexOf('@');
  if (at === -1) return null;
  const domain = address.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  return domain.length > 0 ? domain : null;
}

export type DomainRecordView = {
  kind: DnsRecordKind;
  type: DnsRecordType;
  host: string;
  value: string;
  requiredForSending: boolean;
  status: CheckStatus;
  found: string[];
  problems: string[];
};

/** What the domain setup screen shows (EML-02) plus the sending verdict (EML-03). */
export type DomainView = {
  id: string;
  domain: string;
  status: 'pending' | 'verified' | 'action_needed';
  canSendMarketing: boolean;
  /** Why marketing sends are blocked; null when they are allowed. */
  blockedReason: string | null;
  dmarcPolicy: DmarcPolicy | null;
  warmupStage: number;
  esp: { provider: string; placeholder: boolean };
  records: DomainRecordView[];
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

export type SendVerdict = { allowed: true } | { allowed: false; reason: string };

type Actor = { userId: string };

type DomainServiceDeps = {
  repository: DomainRepository;
  resolver: DnsResolver;
  email: Pick<EmailAdapter, 'registerDomain'>;
  coreEngine: Pick<CoreEngineClient, 'writeActivityLog'>;
  dmarcReportEmail?: string;
  /** A stored "verified" older than this is re-checked live before a marketing send. */
  recheckAfterMs: number;
  now?: () => Date;
};

const SENDING_KINDS: DnsRecordKind[] = ['spf', 'dkim', 'dmarc'];

const isVerified = (domain: SendingDomain) =>
  domain.verifiedAt !== null && SENDING_KINDS.every((kind) => statusField(domain, kind) === 'verified');

function statusField(domain: SendingDomain, kind: DnsRecordKind): CheckStatus {
  switch (kind) {
    case 'spf':
      return domain.spfStatus;
    case 'dkim':
      return domain.dkimStatus;
    case 'dmarc':
      return domain.dmarcStatus;
    case 'tracking':
      return domain.trackingStatus;
  }
}

function blockedReason(domain: SendingDomain): string | null {
  if (isVerified(domain)) return null;
  if (domain.lastCheckedAt === null) return 'DNS records have not been checked yet';
  const failing = SENDING_KINDS.filter((kind) => statusField(domain, kind) !== 'verified').map((kind) => kind.toUpperCase());
  return `${failing.join(', ')} ${failing.length === 1 ? 'does' : 'do'} not pass verification`;
}

export class DomainService {
  private readonly now: () => Date;
  /** One live check per domain at a time: a batch send with a stale verdict shares a single lookup. */
  private readonly inFlight = new Map<string, Promise<SendingDomain | null>>();

  constructor(private readonly deps: DomainServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async list(): Promise<DomainView[]> {
    return (await this.deps.repository.list()).map((domain) => this.toView(domain));
  }

  async get(id: string): Promise<DomainView | null> {
    const domain = await this.deps.repository.findById(id);
    return domain ? this.toView(domain) : null;
  }

  /** Registers the domain with the ESP and stores the records it expects; status starts as pending. */
  async add(input: string, actor: Actor): Promise<DomainView> {
    const domain = normalizeDomain(input);
    const espIdentity = await this.deps.email.registerDomain(domain);
    const created = await this.deps.repository.insert({ domain, espIdentity });
    await this.log(actor, 'sending_domain.added', created);
    return this.toView(created);
  }

  /** Live DNS check (EML-02); stores per-mechanism status and sets or clears verifiedAt (EML-03). */
  async verify(id: string): Promise<DomainView | null> {
    const domain = await this.deps.repository.findById(id);
    if (!domain) return null;
    const updated = await this.runCheck(domain);
    return updated ? this.toView(updated) : null;
  }

  async remove(id: string, actor: Actor): Promise<boolean> {
    const domain = await this.deps.repository.findById(id);
    if (!domain || !(await this.deps.repository.delete(id))) return false;
    await this.log(actor, 'sending_domain.removed', domain);
    return true;
  }

  /**
   * EML-03: marketing email may leave only from a registered domain whose SPF, DKIM and DMARC pass.
   * A stale verdict is refreshed live first, so a record removed from DNS blocks the next send.
   */
  async checkMarketingSend(domainName: string): Promise<SendVerdict> {
    let domain = await this.deps.repository.findByDomain(domainName.toLowerCase());
    if (!domain) return { allowed: false, reason: `${domainName} is not a registered sending domain` };

    const checkedAt = domain.lastCheckedAt?.getTime();
    if (checkedAt === undefined || this.now().getTime() - checkedAt > this.deps.recheckAfterMs) {
      domain = (await this.runCheck(domain)) ?? domain;
    }
    const reason = blockedReason(domain);
    return reason === null ? { allowed: true } : { allowed: false, reason: `${domain.domain}: ${reason}` };
  }

  private expected(domain: SendingDomain) {
    return expectedRecords(domain.domain, domain.espIdentity, { dmarcReportEmail: this.deps.dmarcReportEmail });
  }

  private runCheck(domain: SendingDomain): Promise<SendingDomain | null> {
    const running = this.inFlight.get(domain.id);
    if (running) return running;
    const check = this.check(domain).finally(() => this.inFlight.delete(domain.id));
    this.inFlight.set(domain.id, check);
    return check;
  }

  private async check(domain: SendingDomain): Promise<SendingDomain | null> {
    const now = this.now();
    const check = await checkDomainRecords(this.deps.resolver, this.expected(domain), domain.espIdentity.spfInclude, now);
    const status = {
      spfStatus: statusOf(check, 'spf'),
      dkimStatus: statusOf(check, 'dkim'),
      dmarcStatus: statusOf(check, 'dmarc'),
      trackingStatus: statusOf(check, 'tracking'),
    };
    const passes = status.spfStatus === 'verified' && status.dkimStatus === 'verified' && status.dmarcStatus === 'verified';
    return this.deps.repository.saveCheck(domain.id, {
      ...status,
      dmarcPolicy: check.dmarcPolicy,
      lastCheck: check,
      lastCheckedAt: now,
      // Keep the first time of an unbroken verified streak; any failure resets it.
      verifiedAt: passes ? (domain.verifiedAt ?? now) : null,
    });
  }

  private async log(actor: Actor, action: string, domain: SendingDomain) {
    // Domain changes are admin-only, permission-sensitive actions (PRD 4.3).
    await this.deps.coreEngine.writeActivityLog({
      actorId: actor.userId,
      action,
      subjectType: 'sending_domain',
      subjectId: domain.id,
      occurredAt: this.now().toISOString(),
      metadata: { domain: domain.domain },
    });
  }

  toView(domain: SendingDomain): DomainView {
    const checks = new Map<string, RecordCheck>(
      (domain.lastCheck?.records ?? []).map((check) => [`${check.kind}:${check.host}`, check]),
    );
    const records = this.expected(domain).map((record): DomainRecordView => {
      const check = checks.get(`${record.kind}:${record.host}`);
      return {
        ...record,
        status: check?.status ?? 'pending',
        found: check?.found ?? [],
        problems: check?.problems ?? [],
      };
    });
    const verified = isVerified(domain);
    return {
      id: domain.id,
      domain: domain.domain,
      status: verified ? 'verified' : domain.lastCheckedAt === null ? 'pending' : 'action_needed',
      canSendMarketing: verified,
      blockedReason: blockedReason(domain),
      dmarcPolicy: domain.dmarcPolicy,
      warmupStage: domain.warmupStage,
      esp: { provider: domain.espIdentity.provider, placeholder: domain.espIdentity.placeholder },
      records,
      lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
      verifiedAt: domain.verifiedAt?.toISOString() ?? null,
      createdAt: domain.createdAt.toISOString(),
    };
  }
}
