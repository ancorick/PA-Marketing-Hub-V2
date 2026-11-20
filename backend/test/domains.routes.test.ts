import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIntegrations } from '../src/integrations/index.js';
import type { MockCoreEngineClient } from '../src/integrations/core-engine/mock.js';
import type { DomainView } from '../src/domains/service.js';
import { bearer, buildTestApp, FakeDns, publishPlaceholderRecords } from './helpers.js';

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

  it('rejects malformed and duplicate domains', async () => {
    for (const bad of ['https://news.academy.example', 'news@academy.example', 'localhost', '-bad.example', '']) {
      const response = await addDomain(bad);
      expect(response.statusCode, bad).toBe(400);
      expect(response.json()).toMatchObject({ error: 'invalid_domain' });
    }
    expect((await app.inject({ method: 'POST', url: '/api/email/domains', headers: bearer('admin'), payload: {} })).statusCode).toBe(400);
    await addDomain();
    const duplicate = await addDomain('NEWS.academy.example');
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: 'domain_exists' });
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
