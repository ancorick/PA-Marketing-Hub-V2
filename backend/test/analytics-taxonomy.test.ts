import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contacts, webTrafficDaily } from '../src/db/schema.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp({ email: new LogEmailAdapter({ info: () => {} }) });
});
afterEach(() => app.close());

const signUp = (email: string, utmSource: string, utmMedium: string) =>
  app.inject({
    method: 'POST',
    url: '/api/public/signup',
    payload: { email, language: 'en', consent: [{ topic: 'newsletter', wordingVersion: 'newsletter-en-v1' }], utmSource, utmMedium, utmCampaign: 'creator-test' },
  });

describe('channel taxonomy and unmapped values (ANL-03)', () => {
  it('maps by built-in rules; a direct visit is Search and website; unknown parameters are queued, not folded in', async () => {
    expect(await app.taxonomy.mapUtm('instagram', 'paid_social', 'test')).toBe('paid_social');
    expect(await app.taxonomy.mapUtm(null, null, 'test')).toBe('search_website');
    expect(await app.taxonomy.mapUtm('TikTok', 'Influencer', 'test')).toBeNull();
    expect(await app.taxonomy.mapUtm('tiktok', 'influencer', 'test')).toBeNull();
    const [queued] = await app.taxonomy.unmapped();
    expect(queued).toMatchObject({ source: 'test', field: 'utm', value: 'tiktok / influencer', count: 2, resolvedChannelId: null });
  });

  it('resolving a value adds a rule and remaps stored traffic, touchpoints and the contact source', async () => {
    const { db } = await currentTestDatabase();
    await app.pipeline.pull('website_analytics', { from: '2026-10-01', to: '2026-10-02' });
    expect(await signUp('creator.fan@example.test', 'tiktok', 'influencer')).toHaveProperty('statusCode', 202);
    const [contact] = await db.select().from(contacts).where(eq(contacts.email, 'creator.fan@example.test'));
    expect(contact?.sourceChannel).toBeNull();
    const list = await app.inject({ method: 'GET', url: '/api/analytics/taxonomy', headers: bearer('editor') });
    expect(list.statusCode).toBe(200);
    const values = list.json().unmapped as { id: string; source: string; value: string }[];
    expect(values.map((value) => `${value.source}: ${value.value}`).sort()).toEqual(['website_analytics: tiktok / influencer', 'website_form: tiktok / influencer']);

    const editor = await app.inject({ method: 'POST', url: `/api/analytics/unmapped/${values[0]!.id}/resolve`, headers: bearer('editor'), payload: { channel: 'paid_social' } });
    expect(editor.statusCode).toBe(403);
    const wrong = await app.inject({ method: 'POST', url: `/api/analytics/unmapped/${values[0]!.id}/resolve`, headers: bearer('marketing_manager'), payload: { channel: 'tiktok' } });
    expect(wrong.statusCode).toBe(400);
    const form = values.find((value) => value.source === 'website_form')!;
    const resolved = await app.inject({ method: 'POST', url: `/api/analytics/unmapped/${form.id}/resolve`, headers: bearer('marketing_manager'), payload: { channel: 'paid_social' } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().remapped).toEqual({ webTraffic: 2, touchpoints: 1, contacts: 1 });
    const traffic = await db.select().from(webTrafficDaily).where(eq(webTrafficDaily.utmSource, 'tiktok'));
    expect(traffic.every((row) => row.channel === 'paid_social')).toBe(true);
    const [after] = await db.select().from(contacts).where(eq(contacts.email, 'creator.fan@example.test'));
    expect(after?.sourceChannel).toBe('paid_social');
    // The rule applies to new data from now on.
    expect(await app.taxonomy.mapUtm('tiktok', 'influencer', 'test')).toBe('paid_social');
    const rules = (await app.inject({ method: 'GET', url: '/api/analytics/taxonomy', headers: bearer('editor') })).json().rules;
    expect(rules[0]).toMatchObject({ kind: 'source_medium', value: 'tiktok/influencer', channel: 'paid_social', builtIn: false, createdBy: expect.any(String) });
  });

  it('queues unknown CRM channel labels and maps them after a rule is added', async () => {
    await app.sync.syncLeads(new Date(0));
    const queued = (await app.taxonomy.unmapped()).find((value) => value.field === 'crm_label');
    expect(queued).toMatchObject({ source: 'navigator_crm', value: 'instagram' });
    await app.taxonomy.resolve(queued!.id, 'paid_social', 'mock-marketing_manager');
    await app.sync.syncLeads(new Date(0));
    const { db } = await currentTestDatabase();
    const [maria] = await db.select().from(contacts).where(eq(contacts.email, 'maria.applicant@example.test'));
    expect(maria?.sourceChannel).toBe('paid_social');
  });

  it('staff rules: add, validate and delete; built-in rules stay', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/analytics/taxonomy/rules', headers: bearer('admin'), payload: { kind: 'source_medium', value: 'tiktok', channel: 'paid_social' } });
    expect(bad.statusCode).toBe(400);
    const created = await app.inject({ method: 'POST', url: '/api/analytics/taxonomy/rules', headers: bearer('admin'), payload: { kind: 'medium', value: 'Podcast', channel: 'partners_press' } });
    expect(created.statusCode).toBe(201);
    expect(await app.taxonomy.mapUtm('anything', 'podcast', 'test')).toBe('partners_press');
    const removed = await app.inject({ method: 'DELETE', url: `/api/analytics/taxonomy/rules/${created.json().id}`, headers: bearer('admin') });
    expect(removed.statusCode).toBe(204);
    expect(await app.taxonomy.mapUtm('anything', 'podcast', 'test')).toBeNull();
    const viewer = await app.inject({ method: 'GET', url: '/api/analytics/taxonomy', headers: bearer('viewer') });
    expect(viewer.statusCode).toBe(403);
  });
});
