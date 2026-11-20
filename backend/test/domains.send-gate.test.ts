import { describe, expect, it, vi } from 'vitest';
import { InMemoryDomainRepository } from '../src/domains/repository.js';
import { guardMarketingSends, SendBlockedError } from '../src/domains/send-gate.js';
import { DomainService, fromDomain } from '../src/domains/service.js';
import { createEmailAdapter, type EmailMessage } from '../src/email/index.js';
import { FakeDns, publishPlaceholderRecords } from './helpers.js';

const DOMAIN = 'news.academy.example';
const ADMIN = { userId: 'staff-admin' };

function setup() {
  let now = new Date('2026-11-20T10:00:00Z');
  const dns = new FakeDns();
  const logger = { info: vi.fn() };
  const esp = createEmailAdapter('log', logger);
  const domains = new DomainService({
    repository: new InMemoryDomainRepository(),
    resolver: dns,
    email: esp,
    coreEngine: { writeActivityLog: async () => {} },
    recheckAfterMs: 60 * 60_000,
    now: () => now,
  });
  return {
    dns,
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

  it('blocks marketing from an unregistered domain and from a From without a domain', async () => {
    const { email, logger } = setup();
    await expect(email.send(message())).rejects.toThrow(`${DOMAIN} is not a registered sending domain`);
    await expect(email.send(message({ from: 'nobody' }))).rejects.toBeInstanceOf(SendBlockedError);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('blocks marketing until SPF, DKIM and DMARC pass, checking DNS live', async () => {
    const { email, domains, dns, logger } = setup();
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
    const { email, domains, dns, advance } = setup();
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
    const { email, domains, dns } = setup();
    await domains.add(DOMAIN, ADMIN);
    publishPlaceholderRecords(dns, DOMAIN);
    const lookups = vi.spyOn(dns, 'resolveTxt');
    await Promise.all(Array.from({ length: 20 }, () => email.send(message())));
    // SPF, its include, DKIM key and DMARC: one check, not twenty.
    expect(lookups.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('does not gate transactional mail', async () => {
    const { email } = setup();
    await expect(email.send(message({ stream: 'transactional' }))).resolves.toBeDefined();
  });
});
