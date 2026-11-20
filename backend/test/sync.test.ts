import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outcomes } from '../src/db/schema.js';
import type { MockCoreEngineClient } from '../src/integrations/core-engine/mock.js';
import { createIntegrations, type Integrations } from '../src/integrations/index.js';
import { bearer, buildTestApp, currentTestDatabase } from './helpers.js';

let app: FastifyInstance;
let integrations: Integrations;

beforeEach(async () => {
  integrations = createIntegrations('mock');
  app = await buildTestApp({ integrations });
});
afterEach(() => app.close());

const runJob = (name: string, role = 'admin') => app.inject({ method: 'POST', url: `/api/admin/jobs/${name}/run`, headers: bearer(role) });
const byEmail = async (email: string) => (await app.contacts.list({ search: email, limit: 1, offset: 0 })).contacts[0];

describe('Core Engine and CRM sync (AUD-06)', () => {
  it('creates and links contacts from Core Engine people, mirroring the lifecycle without retyping', async () => {
    const existing = (
      await app.inject({ method: 'POST', url: '/api/audience/contacts', headers: bearer('editor'), payload: { email: 'davit.alumnus@example.test', language: 'en', sourceChannel: 'referrals' } })
    ).json();
    expect(existing.corePersonId).toBe('core-p-002'); // linked at create (AUD-01)

    const run = await runJob('core_people');
    expect(run.json()).toMatchObject({ status: 'ok', rowsIn: 3 });
    expect(await byEmail('ani.student@example.test')).toMatchObject({ corePersonId: 'core-p-001', type: 'student', typeSource: 'core_engine', sourceChannel: null });
    expect(await byEmail('davit.alumnus@example.test')).toMatchObject({ id: existing.id, sourceChannel: 'referrals' });

    // Re-running with the overlap changes nothing.
    expect((await runJob('core_people')).json()).toMatchObject({ status: 'ok', rowsUpserted: 0 });
    expect((await app.contacts.list({ limit: 10, offset: 0 })).total).toBe(3);
  });

  it('mirrors enrollments, applications, CRM stages and employment as outcomes, idempotently', async () => {
    for (const job of ['core_people', 'crm_leads', 'crm_stage_changes', 'core_outcomes', 'alumni_employment']) {
      expect((await runJob(job)).json().status, job).toBe('ok');
    }
    await runJob('core_outcomes');
    const db = (await currentTestDatabase()).db;
    const all = await db.select().from(outcomes);
    expect(all.map((row) => `${row.sourceSystem}:${row.type}`).sort()).toEqual([
      'alumni_tracker:hired',
      'core_engine:completed',
      'core_engine:enrolled',
      'navigator_crm:applied',
      'navigator_crm:lead',
      'navigator_crm:lead',
    ]);
    const enrolled = (await db.select().from(outcomes).where(eq(outcomes.type, 'enrolled')))[0];
    expect(enrolled).toMatchObject({ courseId: 'course-frontend', groupId: 'fe-2026-09' });
    expect(enrolled?.contactId).toBeTruthy();

    const maria = await app.contacts.get((await byEmail('maria.applicant@example.test'))!.id);
    expect(maria).toMatchObject({ type: 'applicant' });
    const gor = await byEmail('gor.lead@example.test');
    expect(gor).toMatchObject({ type: 'lead', sourceChannel: 'search_website', firstTouchAt: '2026-11-10T12:00:00.000Z' });
  });

  it('writes marketing touches of linked contacts to the Core Engine', async () => {
    await runJob('core_people');
    const ani = await byEmail('ani.student@example.test');
    await app.touchpoints.record({ contactId: ani!.id, channel: 'email', campaign: 'newsletter', type: 'click', occurredAt: new Date(), sourceSystem: 'esp', sourceRef: 'm1' });
    expect((await runJob('core_touches_push')).json()).toMatchObject({ status: 'ok', rowsIn: 1 });
    expect([...(integrations.coreEngine as MockCoreEngineClient).touches.values()]).toEqual([expect.objectContaining({ personId: 'core-p-001', type: 'click' })]);
  });

  it('records failures with the error and keeps the cursor for the retry', async () => {
    vi.spyOn(integrations.coreEngine, 'listPeopleChangedSince').mockRejectedValueOnce(new Error('Core Engine 503'));
    expect((await runJob('core_people')).json()).toMatchObject({ status: 'failed', error: 'Core Engine 503' });
    const status = (await app.inject({ method: 'GET', url: '/api/admin/jobs', headers: bearer('marketing_manager') })).json();
    expect(status.jobs.find((job: { name: string }) => job.name === 'core_people')).toMatchObject({ lastRun: { status: 'failed' }, lastSuccessAt: null });
    expect((await runJob('core_people', 'marketing_manager')).statusCode).toBe(403);
    expect((await runJob('core_people')).json().status).toBe('ok');
  });
});
