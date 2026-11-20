import type { EmailAdapter } from '../email/index.js';
import type { CoreEngineClient } from '../integrations/core-engine/contract.js';
import { expectedRecords } from './records.js';
import { DuplicateDomainError, type DomainRepository, type SendingDomain } from './repository.js';
import type { CheckStatus, DmarcPolicy, DnsRecordKind, DnsRecordType, RecordCheck } from './types.js';
import { checkDomainRecords, statusOf, type DnsResolver } from './verify.js';
import { academyDay, isWarmupLength, warmupState, type WarmupLength, type WarmupState } from './warmup.js';

/** A warm-up change that the current plan state does not allow (e.g. after it was skipped). */
export class WarmupChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WarmupChangeError';
  }
}

export class InvalidDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDomainError';
  }
}

/**
 * Host name rules (RFC 1123): 2+ labels of letters, digits and inner hyphens, 253 chars max.
 * The TLD is letters or an IDN in punycode (xn--…), e.g. the Armenian .հայ = xn--y9a3aq.
 */
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function normalizeDomain(input: string): string {
  const domain = input.trim().toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME.test(domain)) {
    throw new InvalidDomainError('Enter a domain name such as news.academy-domain.am, without http:// or an email address');
  }
  return domain;
}

/**
 * Domain of the single address in a From header: "Academy <news@news.example.am>" → news.example.am.
 * Quoted display names are dropped first, so an address written inside the name cannot stand in
 * for the real one (EML-03). Anything ambiguous (several addresses, no address) returns null.
 */
export function fromDomain(from: string): string | null {
  const withoutNames = from.replace(/"(?:[^"\\]|\\.)*"/g, '');
  const angles = withoutNames.match(/<[^<>]*>/g) ?? [];
  const outside = withoutNames.replace(/<[^<>]*>/g, '');
  // A second address outside the angle brackets ("Name <a@x>, b@y") is just as ambiguous.
  if (angles.length > 1 || /[<>]/.test(outside) || (angles.length === 1 && outside.includes('@'))) return null;
  const address = (angles.length === 1 ? (angles[0] as string).slice(1, -1) : withoutNames).trim();
  // One addr-spec only: no list separators, no spaces, exactly one "@".
  if (!/^[^\s,;@]+@[^\s,;@]+$/.test(address)) return null;
  const domain = address.slice(address.indexOf('@') + 1).toLowerCase().replace(/\.$/, '');
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
  /** EML-08: the plan, today's cap and how much of it is used. */
  warmup: WarmupState & { sentToday: number; startedAt: string | null; skippedAt: string | null };
  esp: { provider: string; placeholder: boolean };
  records: DomainRecordView[];
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

/** not_verified: fix DNS, then resume; daily_cap: the warm-up cap is used up, sending resumes tomorrow. */
export type SendVerdict = { allowed: true } | { allowed: false; reason: string; kind: 'not_verified' | 'daily_cap' };

type Actor = { userId: string };

type DomainServiceDeps = {
  repository: DomainRepository;
  resolver: DnsResolver;
  email: Pick<EmailAdapter, 'registerDomain' | 'deregisterDomain'>;
  logger: { error: (obj: object, msg: string) => void };
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
    return Promise.all((await this.deps.repository.list()).map((domain) => this.view(domain)));
  }

  async get(id: string): Promise<DomainView | null> {
    const domain = await this.deps.repository.findById(id);
    return domain ? this.view(domain) : null;
  }

  /** Registers the domain with the ESP and stores the records it expects; status starts as pending. */
  async add(input: string, actor: Actor): Promise<DomainView> {
    const domain = normalizeDomain(input);
    // Check first: registering again with a real ESP can rotate keys or fail.
    if (await this.deps.repository.findByDomain(domain)) throw new DuplicateDomainError(domain);
    const espIdentity = await this.deps.email.registerDomain(domain);
    const created = await this.deps.repository.insert({ domain, espIdentity });
    await this.log(actor, 'sending_domain.added', created);
    return this.view(created);
  }

  /** Live DNS check (EML-02); stores per-mechanism status and sets or clears verifiedAt (EML-03). */
  async verify(id: string): Promise<DomainView | null> {
    const domain = await this.deps.repository.findById(id);
    if (!domain) return null;
    const updated = await this.runCheck(domain);
    return updated ? this.view(updated) : null;
  }

  /**
   * EML-08: change the plan length (14, 21 or 28 days) or skip the plan for a domain that already has
   * a sending reputation. Admin-only and logged; a skipped or finished plan cannot be changed.
   */
  async updateWarmup(id: string, change: { days?: WarmupLength; skip?: true }, actor: Actor): Promise<DomainView | null> {
    const domain = await this.deps.repository.findById(id);
    if (!domain) return null;
    const state = warmupState(domain, this.now());
    if (state.status === 'skipped' || state.status === 'complete') {
      throw new WarmupChangeError(`The warm-up plan is already ${state.status}`);
    }
    if (change.days !== undefined && !isWarmupLength(change.days)) {
      throw new WarmupChangeError('A warm-up plan lasts 14, 21 or 28 days');
    }
    const updated = await this.deps.repository.updateWarmup(id, {
      ...(change.days !== undefined && { warmupDays: change.days }),
      ...(change.skip && { warmupSkippedAt: this.now() }),
    });
    if (!updated) return null;
    await this.log(actor, change.skip ? 'sending_domain.warmup_skipped' : 'sending_domain.warmup_changed', updated, {
      warmupDays: updated.warmupDays,
    });
    return this.view(updated);
  }

  async remove(id: string, actor: Actor): Promise<boolean> {
    const domain = await this.deps.repository.findById(id);
    if (!domain || !(await this.deps.repository.delete(id))) return false;
    await this.deps.email.deregisterDomain(domain.domain);
    await this.log(actor, 'sending_domain.removed', domain);
    return true;
  }

  /**
   * Called once per marketing message, right before it goes to the ESP.
   * EML-03: only a registered domain whose SPF, DKIM and DMARC pass may send. A stale verdict is
   * refreshed live first, so a record removed from DNS blocks the next send.
   * EML-08: during warm-up each allowed message takes one slot of today's cap.
   */
  async authorizeMarketingSend(domainName: string): Promise<SendVerdict> {
    const notRegistered = { allowed: false, kind: 'not_verified', reason: `${domainName} is not a registered sending domain` } as const;
    let domain = await this.deps.repository.findByDomain(domainName.toLowerCase());
    if (!domain) return notRegistered;

    const checkedAt = domain.lastCheckedAt?.getTime();
    if (checkedAt === undefined || this.now().getTime() - checkedAt > this.deps.recheckAfterMs) {
      // null: the domain was removed while DNS was being checked.
      domain = await this.runCheck(domain);
      if (!domain) return notRegistered;
    }
    const reason = blockedReason(domain);
    if (reason !== null) return { allowed: false, kind: 'not_verified', reason: `${domain.domain}: ${reason}` };

    const now = this.now();
    const warmup = warmupState(domain, now);
    if (warmup.status === 'active' && warmup.todayCap !== null) {
      const reserved = await this.deps.repository.reserveDailySend(domain.id, academyDay(now), warmup.todayCap);
      if (!reserved) {
        return {
          allowed: false,
          kind: 'daily_cap',
          reason: `${domain.domain}: warm-up day ${warmup.day} of ${warmup.days}, today's cap of ${warmup.todayCap} marketing emails is reached; sending resumes tomorrow`,
        };
      }
    }
    return { allowed: true };
  }

  /**
   * How many more marketing emails the domain may send today; null = no warm-up cap.
   * The send pipeline (phase 1, EML-09) uses it to send to the most engaged contacts first.
   */
  async remainingToday(domainName: string): Promise<number | null> {
    const domain = await this.deps.repository.findByDomain(domainName.toLowerCase());
    if (!domain) return 0;
    const now = this.now();
    const warmup = warmupState(domain, now);
    if (warmup.status !== 'active' || warmup.todayCap === null) return null;
    return Math.max(0, warmup.todayCap - (await this.deps.repository.sentOn(domain.id, academyDay(now))));
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
    // A failed lookup says nothing about the records: keep the previous status for that mechanism,
    // and leave lastCheckedAt so the next send checks again instead of waiting for the verdict to age.
    const settle = (kind: DnsRecordKind, previous: CheckStatus) => {
      const current = statusOf(check, kind);
      return current === 'error' ? previous : current;
    };
    const status = {
      spfStatus: settle('spf', domain.spfStatus),
      dkimStatus: settle('dkim', domain.dkimStatus),
      dmarcStatus: settle('dmarc', domain.dmarcStatus),
      trackingStatus: settle('tracking', domain.trackingStatus),
    };
    const inconclusive = check.records.some((record) => record.status === 'error');
    const passes = status.spfStatus === 'verified' && status.dkimStatus === 'verified' && status.dmarcStatus === 'verified';
    return this.deps.repository.saveCheck(domain.id, {
      ...status,
      dmarcPolicy: statusOf(check, 'dmarc') === 'error' ? domain.dmarcPolicy : check.dmarcPolicy,
      lastCheck: check,
      lastCheckedAt: inconclusive ? domain.lastCheckedAt : now,
      // Keep the first time of an unbroken verified streak; a real failure resets it.
      verifiedAt: passes ? (domain.verifiedAt ?? now) : null,
      // EML-08: the warm-up plan starts on the day the domain first passes; it never restarts by itself.
      warmupStartedAt: domain.warmupStartedAt ?? (passes ? now : null),
    });
  }

  private async log(actor: Actor, action: string, domain: SendingDomain, metadata: Record<string, unknown> = {}) {
    // Domain changes are admin-only, permission-sensitive actions (PRD 4.3). The change is already
    // committed, so a Core Engine outage must not turn it into an error the admin would retry.
    const entry = {
      actorId: actor.userId,
      action,
      subjectType: 'sending_domain',
      subjectId: domain.id,
      occurredAt: this.now().toISOString(),
      metadata: { domain: domain.domain, ...metadata },
    };
    try {
      await this.deps.coreEngine.writeActivityLog(entry);
    } catch (error) {
      this.deps.logger.error({ err: error, activity: entry }, 'activity log write failed');
    }
  }

  private async view(domain: SendingDomain): Promise<DomainView> {
    const now = this.now();
    const warmup = warmupState(domain, now);
    const sentToday = warmup.status === 'active' ? await this.deps.repository.sentOn(domain.id, academyDay(now)) : 0;
    return this.toView(domain, warmup, sentToday);
  }

  private toView(domain: SendingDomain, warmup: WarmupState, sentToday: number): DomainView {
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
      warmup: {
        ...warmup,
        sentToday,
        startedAt: domain.warmupStartedAt?.toISOString() ?? null,
        skippedAt: domain.warmupSkippedAt?.toISOString() ?? null,
      },
      esp: { provider: domain.espIdentity.provider, placeholder: domain.espIdentity.placeholder },
      records,
      lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
      verifiedAt: domain.verifiedAt?.toISOString() ?? null,
      createdAt: domain.createdAt.toISOString(),
    };
  }
}
