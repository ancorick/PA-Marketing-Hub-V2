import { describe, expect, it, vi } from 'vitest';
import { DrizzleDomainRepository } from '../src/domains/repository.js';
import { guardMarketingSends, SendBlockedError } from '../src/domains/send-gate.js';
import { DomainService, fromDomain } from '../src/domains/service.js';
import { createEmailAdapter, type EmailMessage } from '../src/email/index.js';
import { FakeDns, publishPlaceholderRecords, testDatabase } from './helpers.js';

const DOMAIN = 'news.academy.example';
const ADMIN = { userId: 'staff-admin' };

async function setup() {
  let now = new Date('2026-11-20T10:00:00Z');
  const dns = new FakeDns();
  const logger = { info: vi.fn() };
  const esp = createEmailAdapter('log', logger);
  const repository = new DrizzleDomainRepository((await testDatabase()).db);
  const domains = new DomainService({
    repository,
    resolver: dns,
    email: esp,
    logger: { error: vi.fn() },
    coreEngine: { writeActivityLog: async () => {} },
    recheckAfterMs: 60 * 60_000,
    now: () => now,
  });
  return {
    dns,
    repository,
    logger,
    domains,
    email: guardMarketingSends(esp, domains),
    advance: (minutes: number) => {
      now = new Date(now.getTime() + minutes * 60_000);
    },
  };
}

const message = (overrides: Partial<EmailMessage> = {}): EmailMessage => ({
  idempotencyKey: `send-1:${Math.random()}`,
  stream: 'marketing',
  from: `Picsart Academy <news@${DOMAIN}>`,
  to: 'ani.student@example.test',
  subject: 'New courses',
  html: '<p>Hi</p>',
  text: 'Hi',
  ...overrides,
});

describe('marketing send gate (EML-03)', () => {
  it('reads the domain from a From header', () => {
    expect(fromDomain('Academy <News@News.Academy.Example>')).toBe(DOMAIN);
    expect(fromDomain(`news@${DOMAIN}`)).toBe(DOMAIN);
    expect(fromDomain('no-address')).toBeNull();
  });

  it('ignores addresses inside a quoted display name and refuses several addresses', () => {
    expect(fromDomain('"Academy <news@news.verified.am>" <promo@unverified.am>')).toBe('unverified.am');
    expect(fromDomain('"Escaped \\" <x@a.am>" <promo@unverified.am>')).toBe('unverified.am');
    expect(fromDomain('Academy <news@a.am>, promo@b.am')).toBeNull();
    expect(fromDomain('<news@a.am>, <promo@b.am>')).toBeNull();
    expect(fromDomain('news@a.am, promo@b.am')).toBeNull();
    expect(fromDomain('Academy <news@a.am')).toBeNull();
  });

  it('blocks marketing from an unregistered domain and from a From without a domain', async () => {
    const { email, logger } = await setup();
    await expect(email.send(message())).rejects.toThrow(`${DOMAIN} is not a registered sending domain`);
    await expect(email.send(message({ from: 'nobody' }))).rejects.toBeInstanceOf(SendBlockedError);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('blocks marketing until SPF, DKIM and DMARC pass, checking DNS live', async () => {
    const { email, domains, dns, logger } = await setup();
    await domains.add(DOMAIN, ADMIN);
    dns.setTxt(DOMAIN, 'v=spf1 include:spf.esp-not-chosen.invalid -all');
    const blocked = email.send(message());
    await expect(blocked).rejects.toBeInstanceOf(SendBlockedError);
    await expect(blocked).rejects.toThrow('DKIM, DMARC do not pass verification');

    publishPlaceholderRecords(dns, DOMAIN);
    // The failed verdict is fresh, so it is re-checked only after it goes stale or on "Check DNS".
    const [stored] = await domains.list();
    await domains.verify(stored!.id);
    await expect(email.send(message())).resolves.toMatchObject({ messageId: expect.stringMatching(/^log-/) });
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it('re-checks a stale verdict, so a record removed from DNS blocks the next send', async () => {
    const { email, domains, dns, advance } = await setup();
    await domains.add(DOMAIN, ADMIN);
    publishPlaceholderRecords(dns, DOMAIN);
    await expect(email.send(message())).resolves.toBeDefined();

    dns.txt.delete(`_dmarc.${DOMAIN}`);
    advance(30);
    await expect(email.send(message())).resolves.toBeDefined();
    advance(31);
    await expect(email.send(message())).rejects.toThrow('DMARC does not pass verification');
  });

  it('shares one DNS check between concurrent sends with a stale verdict', async () => {
    const { email, domains, dns } = await setup();
    await domains.add(DOMAIN, ADMIN);
    publishPlaceholderRecords(dns, DOMAIN);
    const lookups = vi.spyOn(dns, 'resolveTxt');
    await Promise.all(Array.from({ length: 20 }, () => email.send(message())));
    // SPF, its include, DKIM key and DMARC: one check, not twenty.
    expect(lookups.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('keeps a verified verdict when DNS lookups fail, and checks again on the next send', async () => {
    const { email, domains, dns, advance } = await setup();
    await domains.add(DOMAIN, ADMIN);
    publishPlaceholderRecords(dns, DOMAIN);
    await expect(email.send(message())).resolves.toBeDefined();
    const [verified] = await domains.list();

    advance(61);
    dns.failing.add(`_dmarc.${DOMAIN}`);
    await expect(email.send(message())).resolves.toBeDefined();
    const [afterTimeout] = await domains.list();
    expect(afterTimeout).toMatchObject({ canSendMarketing: true, verifiedAt: verified!.verifiedAt, lastCheckedAt: verified!.lastCheckedAt });
    expect(afterTimeout!.records.find((record) => record.kind === 'dmarc')?.status).toBe('error');

    // The DNS server recovers and the record is really gone: the next send sees it.
    dns.failing.clear();
    dns.txt.delete(`_dmarc.${DOMAIN}`);
    await expect(email.send(message())).rejects.toThrow('DMARC does not pass verification');
  });

  it('never trusts a stale verdict for a domain removed while it was being re-checked', async () => {
    const { email, domains, dns, repository, advance } = await setup();
    const { id } = await domains.add(DOMAIN, ADMIN);
    publishPlaceholderRecords(dns, DOMAIN);
    await domains.verify(id);
    advance(61);
    const resolveTxt = dns.resolveTxt.bind(dns);
    vi.spyOn(dns, 'resolveTxt').mockImplementation(async (host) => {
      await repository.delete(id);
      return resolveTxt(host);
    });
    await expect(email.send(message())).rejects.toThrow('is not a registered sending domain');
  });

  it('starts the warm-up on first verification and stops at the daily cap (EML-08)', async () => {
    const { email, domains, dns, advance } = await setup();
    const { id } = await domains.add(DOMAIN, ADMIN);
    publishPlaceholderRecords(dns, DOMAIN);
    const verified = await domains.verify(id);
    expect(verified?.warmup).toMatchObject({ status: 'active', day: 1, todayCap: 50, sentToday: 0 });
    expect(await domains.remainingToday(DOMAIN)).toBe(50);

    const results = await Promise.allSettled(Array.from({ length: 60 }, () => email.send(message())));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(50);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(SendBlockedError);
    expect(rejected.reason.message).toMatch(/warm-up day 1 of 21, today's cap of 50 marketing emails is reached/);
    expect(await domains.remainingToday(DOMAIN)).toBe(0);
    // Transactional mail is not counted against the cap.
    await expect(email.send(message({ stream: 'transactional' }))).resolves.toBeDefined();

    advance(24 * 60);
    expect((await domains.get(id))?.warmup).toMatchObject({ day: 2, sentToday: 0 });
    await expect(email.send(message())).resolves.toBeDefined();
  });

  it('lets marketing flow without a cap once the plan is skipped', async () => {
    const { email, domains, dns } = await setup();
    const { id } = await domains.add(DOMAIN, ADMIN);
    publishPlaceholderRecords(dns, DOMAIN);
    await domains.verify(id);
    await domains.updateWarmup(id, { skip: true }, ADMIN);
    await Promise.all(Array.from({ length: 60 }, () => email.send(message())));
    expect(await domains.remainingToday(DOMAIN)).toBeNull();
  });

  it('does not gate transactional mail', async () => {
    const { email } = await setup();
    await expect(email.send(message({ stream: 'transactional' }))).resolves.toBeDefined();
  });
});
