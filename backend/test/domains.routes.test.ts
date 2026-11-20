import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntegrations } from '../src/integrations/index.js';
import type { MockCoreEngineClient } from '../src/integrations/core-engine/mock.js';
import type { DomainView } from '../src/domains/service.js';
import { buildApp } from '../src/app.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { bearer, buildTestApp, FakeDns, publishPlaceholderRecords, testConfig } from './helpers.js';

const DOMAIN = 'news.academy.example';
let app: FastifyInstance;
let dns: FakeDns;
let coreEngine: MockCoreEngineClient;

beforeEach(async () => {
  dns = new FakeDns();
  const integrations = createIntegrations('mock');
  coreEngine = integrations.coreEngine as MockCoreEngineClient;
  app = await buildTestApp({ dnsResolver: dns, integrations });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

const addDomain = (domain = DOMAIN, role = 'admin') =>
  app.inject({ method: 'POST', url: '/api/email/domains', headers: bearer(role), payload: { domain } });

describe('roles on /api/email/domains (PRD 4.3, NFR-S1)', () => {
  it('rejects requests without a valid staff token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/email/domains' })).statusCode).toBe(401);
    const forged = await app.inject({ method: 'GET', url: '/api/email/domains', headers: { authorization: 'Bearer forged' } });
    expect(forged.statusCode).toBe(401);
    expect(forged.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('lets marketing managers view and re-check, but only admins add and remove', async () => {
    for (const role of ['viewer', 'editor', 'leadership']) {
      expect((await app.inject({ method: 'GET', url: '/api/email/domains', headers: bearer(role) })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: '/api/email/domains', headers: bearer('marketing_manager') })).statusCode).toBe(200);
    expect((await addDomain(DOMAIN, 'marketing_manager')).statusCode).toBe(403);

    const created = (await addDomain()).json<DomainView>();
    const verify = await app.inject({
      method: 'POST',
      url: `/api/email/domains/${created.id}/verify`,
      headers: bearer('marketing_manager'),
    });
    expect(verify.statusCode).toBe(200);
    const remove = await app.inject({ method: 'DELETE', url: `/api/email/domains/${created.id}`, headers: bearer('marketing_manager') });
    expect(remove.statusCode).toBe(403);
  });
});

describe('domain setup (EML-02)', () => {
  it('adds a domain with the exact records to publish, pending until checked', async () => {
    const response = await addDomain('  News.Academy.Example. ');
    expect(response.statusCode).toBe(201);
    const domain = response.json<DomainView>();
    expect(domain).toMatchObject({
      domain: DOMAIN,
      status: 'pending',
      canSendMarketing: false,
      blockedReason: 'DNS records have not been checked yet',
      esp: { provider: 'log', placeholder: true },
      lastCheckedAt: null,
    });
    expect(domain.records.map((record) => [record.kind, record.type, record.host, record.status])).toEqual([
      ['spf', 'TXT', DOMAIN, 'pending'],
      ['dkim', 'CNAME', `mh1._domainkey.${DOMAIN}`, 'pending'],
      ['dmarc', 'TXT', `_dmarc.${DOMAIN}`, 'pending'],
      ['tracking', 'CNAME', `click.${DOMAIN}`, 'pending'],
    ]);
    expect(coreEngine.activityLog).toEqual([
      expect.objectContaining({ actorId: 'staff-admin', action: 'sending_domain.added', subjectId: domain.id }),
    ]);
  });

  it('accepts internationalized TLDs in punycode', async () => {
    expect((await addDomain('news.academy.xn--y9a3aq')).statusCode).toBe(201);
  });

  it('rejects malformed and duplicate domains', async () => {
    for (const bad of ['https://news.academy.example', 'news@academy.example', 'localhost', '-bad.example', '']) {
      const response = await addDomain(bad);
      expect(response.statusCode, bad).toBe(400);
      expect(response.json()).toMatchObject({ error: 'invalid_domain' });
    }
    expect((await app.inject({ method: 'POST', url: '/api/email/domains', headers: bearer('admin'), payload: {} })).statusCode).toBe(400);
    await addDomain();
    const register = vi.spyOn(LogEmailAdapter.prototype, 'registerDomain');
    const duplicate = await addDomain('NEWS.academy.example');
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: 'domain_exists' });
    // The ESP is not asked to register the domain a second time.
    expect(register).not.toHaveBeenCalled();
  });

  it('verifies live: action needed until SPF, DKIM and DMARC pass, then verified', async () => {
    const { id } = (await addDomain()).json<DomainView>();
    const verify = async () =>
      (await app.inject({ method: 'POST', url: `/api/email/domains/${id}/verify`, headers: bearer('admin') })).json<DomainView>();

    const before = await verify();
    expect(before).toMatchObject({ status: 'action_needed', canSendMarketing: false, blockedReason: 'SPF, DKIM, DMARC do not pass verification' });
    expect(before.records[0]).toMatchObject({ status: 'missing', problems: [`No TXT record at ${DOMAIN} yet`] });

    publishPlaceholderRecords(dns, DOMAIN);
    dns.cname.delete(`click.${DOMAIN}`);
    const after = await verify();
    expect(after).toMatchObject({ status: 'verified', canSendMarketing: true, blockedReason: null, dmarcPolicy: 'none' });
    expect(after.verifiedAt).not.toBeNull();
    // The tracking CNAME is shown but does not gate sending.
    expect(after.records.find((record) => record.kind === 'tracking')?.status).toBe('missing');

    const list = await app.inject({ method: 'GET', url: '/api/email/domains', headers: bearer('admin') });
    expect(list.json<{ domains: DomainView[] }>().domains).toEqual([after]);
  });

  it('removes a domain and logs it; unknown or malformed ids are 404', async () => {
    const { id } = (await addDomain()).json<DomainView>();
    const remove = () => app.inject({ method: 'DELETE', url: `/api/email/domains/${id}`, headers: bearer('admin') });
    expect((await remove()).statusCode).toBe(204);
    expect((await remove()).statusCode).toBe(404);
    expect(coreEngine.activityLog.map((entry) => entry.action)).toEqual(['sending_domain.added', 'sending_domain.removed']);
    const malformed = await app.inject({ method: 'POST', url: '/api/email/domains/not-a-uuid/verify', headers: bearer('admin') });
    expect(malformed.statusCode).toBe(404);
  });
});

describe('warm-up settings (EML-08)', () => {
  const patch = (id: string, payload: object, role = 'admin') =>
    app.inject({ method: 'PATCH', url: `/api/email/domains/${id}/warmup`, headers: bearer(role), payload });

  it('shows the plan and lets only admins change its length or skip it', async () => {
    const created = (await addDomain()).json<DomainView>();
    expect(created.warmup).toMatchObject({ status: 'not_started', days: 21, sentToday: 0, startedAt: null });
    expect(created.warmup.plan).toHaveLength(21);

    expect((await patch(created.id, { days: 14 }, 'marketing_manager')).statusCode).toBe(403);
    const shorter = await patch(created.id, { days: 14 });
    expect(shorter.statusCode).toBe(200);
    expect(shorter.json<DomainView>().warmup).toMatchObject({ days: 14 });
    expect(shorter.json<DomainView>().warmup.plan).toHaveLength(14);

    for (const bad of [{ days: 10 }, {}, { skip: false }, { days: 14, extra: 1 }]) {
      expect((await patch(created.id, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }

    const skipped = await patch(created.id, { skip: true });
    expect(skipped.json<DomainView>().warmup).toMatchObject({ status: 'skipped', todayCap: null });
    expect(skipped.json<DomainView>().warmup.skippedAt).not.toBeNull();
    const locked = await patch(created.id, { days: 28 });
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ error: 'warmup_locked' });

    expect(coreEngine.activityLog.map((entry) => entry.action)).toEqual([
      'sending_domain.added',
      'sending_domain.warmup_changed',
      'sending_domain.warmup_skipped',
    ]);
    expect((await patch('00000000-0000-4000-8000-000000000000', { days: 14 })).statusCode).toBe(404);
  });
});

describe('domain changes when the Core Engine activity log is down', () => {
  it('still answers with the committed change instead of an error the admin would retry', async () => {
    vi.spyOn(coreEngine, 'writeActivityLog').mockRejectedValue(new Error('Core Engine timeout'));
    const response = await addDomain();
    expect(response.statusCode).toBe(201);
    const { id } = response.json<DomainView>();
    expect((await app.inject({ method: 'DELETE', url: `/api/email/domains/${id}`, headers: bearer('admin') })).statusCode).toBe(204);
  });
});

describe('mock sign-in on a deployed API', () => {
  it('rejects the public mock tokens in production unless explicitly allowed', async () => {
    const production = await buildApp({ config: testConfig({ NODE_ENV: 'production' }), dnsResolver: new FakeDns() });
    try {
      const response = await production.inject({ method: 'GET', url: '/api/email/domains', headers: bearer('admin') });
      expect(response.statusCode).toBe(401);
    } finally {
      await production.close();
    }
  });
});
