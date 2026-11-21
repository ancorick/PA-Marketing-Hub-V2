import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, buildTestApp } from './helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

const create = (payload: Record<string, unknown>, role = 'editor') => app.inject({ method: 'POST', url: '/api/analytics/links', headers: bearer(role), payload });

describe('campaign link builder (ANL-04)', () => {
  it('builds a tagged URL from the taxonomy and a short link that redirects and counts clicks', async () => {
    const response = await create({ destinationUrl: 'https://academy.example/courses/frontend?lang=hy', channel: 'paid_social', source: 'Instagram', campaign: 'Autumn Intake 2026', content: 'Story A', label: 'Story ad' });
    expect(response.statusCode).toBe(201);
    const link = response.json();
    expect(link).toMatchObject({ channel: 'paid_social', utmSource: 'instagram', utmMedium: 'paid_social', utmCampaign: 'autumn-intake-2026', utmContent: 'story-a', clicks: 0 });
    const full = new URL(link.fullUrl);
    expect(full.searchParams.get('lang')).toBe('hy');
    expect(Object.fromEntries([...full.searchParams].filter(([key]) => key.startsWith('utm_')))).toEqual({
      utm_source: 'instagram',
      utm_medium: 'paid_social',
      utm_campaign: 'autumn-intake-2026',
      utm_content: 'story-a',
    });
    expect(link.shortUrl).toMatch(/\/l\/[A-Za-z0-9]{7}$/);
    // The parameters map back to the same channel.
    expect(await app.taxonomy.mapUtm(link.utmSource, link.utmMedium, 'test')).toBe('paid_social');

    const redirect = await app.inject({ method: 'GET', url: `/l/${link.code}` });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe(link.fullUrl);
    const listed = await app.inject({ method: 'GET', url: '/api/analytics/links', headers: bearer('editor') });
    expect(listed.json().links[0]).toMatchObject({ code: link.code, clicks: 1 });
    expect(listed.json().campaigns).toContain('autumn-intake-2026');
    expect((await app.inject({ method: 'GET', url: '/l/nope000' })).statusCode).toBe(404);
  });

  it('rejects addresses that are not web pages or already carry utm parameters, and missing fields', async () => {
    expect((await create({ destinationUrl: 'javascript:alert(1)', channel: 'email', source: 'newsletter', campaign: 'x' })).json()).toMatchObject({ field: 'destinationUrl' });
    expect((await create({ destinationUrl: 'https://a.example/?utm_source=x', channel: 'email', source: 'newsletter', campaign: 'x' })).json()).toMatchObject({ field: 'destinationUrl' });
    expect((await create({ destinationUrl: 'https://a.example/', channel: 'email', source: 'newsletter', campaign: '  ' })).json()).toMatchObject({ field: 'campaign' });
    expect((await create({ destinationUrl: 'https://a.example/', channel: 'tiktok', source: 'x', campaign: 'y' })).statusCode).toBe(400);
  });

  it('refuses a source that a staff rule sends to another channel', async () => {
    await app.taxonomy.addRule({ kind: 'source_medium', value: 'partner-x/paid_social', channel: 'partners_press' }, 'mock-admin');
    const response = await create({ destinationUrl: 'https://a.example/', channel: 'paid_social', source: 'partner-x', campaign: 'y' });
    expect(response.statusCode).toBe(400);
    expect(response.json().field).toBe('source');
  });

  it('is for the marketing team: viewers and leadership cannot create links', async () => {
    expect((await create({ destinationUrl: 'https://a.example/', channel: 'email', source: 'newsletter', campaign: 'y' }, 'viewer')).statusCode).toBe(403);
    expect((await create({ destinationUrl: 'https://a.example/', channel: 'email', source: 'newsletter', campaign: 'y' }, 'leadership')).statusCode).toBe(403);
  });
});
