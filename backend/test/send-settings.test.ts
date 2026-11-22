import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportLog, syncRuns } from '../src/db/schema.js';
import { seedDemoInbox } from '../src/demo/inbox.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { bearer, buildTestApp, currentTestDatabase, testConfig } from './helpers.js';

/* RESTRUCTURE R5, groups SEND and SETTINGS: data added for the Newsletter, Campaign emails, Dev inbox, Alerts and Admin pages. */

let app: FastifyInstance;
let adapter: LogEmailAdapter;
beforeEach(async () => {
  adapter = new LogEmailAdapter({ info: () => {} });
  app = await buildTestApp({ email: adapter });
});
afterEach(() => app.close());

const get = (url: string, role = 'marketing_manager') => app.inject({ method: 'GET', url, headers: bearer(role as 'admin') });

describe('Dev inbox', () => {
  it('lists the messages of the log adapter, filters by recipient and opens one', async () => {
    expect(seedDemoInbox(adapter, new Date('2026-11-20T10:00:00Z'))).toBe(5);
    expect(seedDemoInbox(adapter)).toBe(0);

    const all = (await get('/api/dev/inbox')).json();
    expect(all.total).toBe(5);
    expect(all.messages[0].subject).toContain('Welcome to Picsart Academy');

    const filtered = (await get('/api/dev/inbox?to=bounce')).json();
    expect(filtered.messages.map((m: { to: string }) => m.to)).toEqual(['bounce.check@mail.example']);

    const one = (await get(`/api/dev/inbox/${all.messages[0].id}`)).json();
    expect(one.html).toContain('<h1');
    expect((await get('/api/dev/inbox/missing')).statusCode).toBe(404);
  });

  it('is not registered in production', async () => {
    const production = await buildTestApp({ email: new LogEmailAdapter({ info: () => {} }), config: { ...testConfig(), nodeEnv: 'production' } });
    expect(production.devInbox).toBeNull();
    expect((await production.inject({ method: 'GET', url: '/api/dev/inbox', headers: bearer('admin') })).statusCode).toBe(404);
    await production.close();
  });
});

describe('Activity log', () => {
  it('merges contact changes, job runs and exports, filters by action and hides nothing from managers', async () => {
    const created = await app.contacts.create({ email: 'activity@example.test', firstName: 'A', lastName: 'B', language: 'en', sourceChannel: 'organic_social' }, { userId: 'staff-editor' });
    const { db } = await currentTestDatabase();
    await db.insert(syncRuns).values({ source: 'google_ads', startedAt: new Date(), status: 'ok', rowsIn: 4, rowsUpserted: 4, triggeredBy: 'scheduler' });
    await db.insert(exportLog).values({ actorId: 'staff-marketing_manager', kind: 'segment_csv', segmentName: 'Leads', rowCount: 12 });

    const all = (await get('/api/admin/activity')).json();
    expect(all.actions).toEqual(expect.arrayContaining(['contact.created', 'job.run', 'export.segment_csv']));
    expect(all.total).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(all.events)).not.toContain('activity@example.test');
    expect(created.id).toBeTruthy();

    const runs = (await get('/api/admin/activity?action=job.run')).json();
    expect(runs.events).toHaveLength(1);
    expect(runs.events[0]).toMatchObject({ who: 'scheduler', entity: 'google_ads', details: { rowsIn: 4 } });

    expect((await get('/api/admin/activity', 'editor')).statusCode).toBe(403);
    expect((await get('/api/admin/activity?limit=0')).statusCode).toBe(400);
  });
});

describe('Newsletter ranking and issue overview', () => {
  it('returns default weights, saves new ones for managers only and rejects out-of-range values', async () => {
    const before = (await get('/api/newsletter/ranking', 'editor')).json();
    expect(before.ranking.weights.graduation).toBe(1);
    const weights = { ...before.ranking.weights, graduation: 0.4 };
    const save = (role: string, body: unknown) => app.inject({ method: 'PUT', url: '/api/newsletter/ranking', headers: { ...bearer(role as 'admin'), 'content-type': 'application/json' }, payload: JSON.stringify(body) });
    expect((await save('editor', { weights, halfLifeDays: 10 })).statusCode).toBe(403);
    expect((await save('marketing_manager', { weights: { ...weights, hire: 3 }, halfLifeDays: 10 })).statusCode).toBe(400);
    expect((await save('marketing_manager', { weights, halfLifeDays: 10 })).json().ranking).toMatchObject({ halfLifeDays: 10, weights: { graduation: 0.4 } });
    expect((await get('/api/newsletter/ranking')).json().ranking.weights.graduation).toBe(0.4);
  });

  it('answers the issue overview and the send stats even when nothing exists yet', async () => {
    expect((await get('/api/newsletter/issues/overview')).json()).toEqual({ overview: [] });
    expect((await get('/api/email/sends/stats')).json()).toEqual({ stats: [] });
    expect((await get('/api/email/guardrails')).json().guardrails.hardBounceRate).toBe(0.05);
  });
});

describe('Alerts history', () => {
  it('adds resolved alerts only when asked', async () => {
    const first = await app.alerts.raise({ level: 'warning', roles: ['marketing_manager'], title: 'One', message: 'm' });
    await app.alerts.raise({ level: 'critical', roles: ['marketing_manager'], title: 'Two', message: 'm' });
    await app.alerts.resolve(first.id, 'test');
    expect((await get('/api/alerts')).json().alerts).toHaveLength(1);
    expect((await get('/api/alerts?resolved=true')).json().alerts).toHaveLength(2);
  });
});
