import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issues } from '../src/db/schema.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { bearer, buildTestApp, currentTestDatabase, testConfig } from './helpers.js';

let app: FastifyInstance;
let outbox: LogEmailAdapter;
let issueId: string;

beforeEach(async () => {
  outbox = new LogEmailAdapter({ info: () => {} });
  app = await buildTestApp({ email: outbox, config: testConfig({ NEWSLETTER_EDITOR_EMAILS: 'editor@academy.example', ADMISSIONS_URL: 'https://academy.example/admissions' }) });
  await app.newsletter.saveCadence({ name: 'Monthly', sendDay: 10, sendHour: 11, collectWorkingDays: 5, languages: ['en'], segments: {}, active: true });
  await app.newsletter.schedule();
  issueId = (await app.newsletter.list())[0]!.id;
  await app.newsletter.collectAndDraft(issueId);
});
afterEach(() => app.close());

const detail = async () => (await app.inject({ method: 'GET', url: `/api/newsletter/issues/${issueId}`, headers: bearer('editor') })).json();
const edits = async () => (await app.inject({ method: 'GET', url: `/api/newsletter/issues/${issueId}/edits`, headers: bearer('editor') })).json().edits;

describe('draft ready notice (NWS-04)', () => {
  it('emails the newsletter editors with a link to the draft', () => {
    const notice = outbox.outbox.find((message) => message.to === 'editor@academy.example');
    expect(notice).toMatchObject({ stream: 'transactional', subject: expect.stringMatching(/^Newsletter draft ready/) });
    expect(notice!.text).toContain(`/#/newsletter/${issueId}`);
  });
});

describe('block editor (NWS-05) and edit log (NWS-17)', () => {
  it('edits text, reorders, removes and adds blocks, logging before and after', async () => {
    const { blocks } = await detail();
    const lead = blocks[0];
    const edited = await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}/blocks/${lead.id}`, headers: bearer('editor'), payload: { body: 'Our biggest graduation yet.' } });
    expect(edited.json()).toMatchObject({ body: 'Our biggest graduation yet.', editedBy: 'staff-editor' });

    const added = await app.inject({
      method: 'POST',
      url: `/api/newsletter/issues/${issueId}/blocks`,
      headers: bearer('editor'),
      payload: { title: 'Scholarships', body: 'Ten scholarships for women in tech. [Read more](https://academy.example/scholarships)', imageUrl: 'https://academy.example/s.png', imageAlt: 'Students at a laptop', position: 1 },
    });
    expect(added.statusCode).toBe(201);
    const noAlt = await app.inject({ method: 'POST', url: `/api/newsletter/issues/${issueId}/blocks`, headers: bearer('editor'), payload: { title: 'X', body: 'Y', imageUrl: 'https://academy.example/x.png' } });
    expect(noAlt.json().message).toMatch(/alt text/);

    const order = (await detail()).blocks.map((block: { id: string }) => block.id).reverse();
    await app.inject({ method: 'PUT', url: `/api/newsletter/issues/${issueId}/order`, headers: bearer('editor'), payload: { blockIds: order } });
    expect((await detail()).blocks.map((block: { id: string }) => block.id)).toEqual(order);

    await app.inject({ method: 'DELETE', url: `/api/newsletter/issues/${issueId}/blocks/${added.json().id}`, headers: bearer('editor') });
    const positions = (await detail()).blocks.map((block: { position: number }) => block.position);
    expect(positions).toEqual(positions.map((_: number, index: number) => index));

    const log = await edits();
    expect(log.map((entry: { action: string }) => entry.action)).toEqual(['remove', 'reorder', 'add', 'edit']);
    expect(log.at(-1)).toMatchObject({ field: 'body', before: lead.body, after: 'Our biggest graduation yet.', actorId: 'staff-editor' });
  });

  it('swaps an item for another publishable one, never for a skipped one', async () => {
    const { blocks, items } = await detail();
    const upcoming = blocks.find((block: { type: string }) => block.type === 'new_groups' || block.type === 'library');
    const spare = items.find((item: { used: boolean; publishable: boolean; type: string }) => !item.used && item.publishable);
    const skipped = items.find((item: { publishable: boolean }) => !item.publishable);
    expect((await app.inject({ method: 'POST', url: `/api/newsletter/issues/${issueId}/blocks/${upcoming.id}/swap`, headers: bearer('editor'), payload: { removeItemId: upcoming.itemIds[0], addItemId: skipped.id } })).json().message).toMatch(/cannot be published/);
    if (spare) {
      const swapped = await app.inject({ method: 'POST', url: `/api/newsletter/issues/${issueId}/blocks/${upcoming.id}/swap`, headers: bearer('editor'), payload: { removeItemId: upcoming.itemIds[0], addItemId: spare.id } });
      expect(swapped.json().itemIds).toContain(spare.id);
    }
  });

  it('sends an approved issue back to "needs approval" on any edit (story NWS-S2)', async () => {
    const db = (await currentTestDatabase()).db;
    await db.update(issues).set({ status: 'approved' }).where(eq(issues.id, issueId));
    await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}`, headers: bearer('editor'), payload: { subject: 'A better subject' } });
    expect((await app.newsletter.require(issueId))).toMatchObject({ status: 'in_review', subject: 'A better subject' });
    await db.update(issues).set({ status: 'sent' }).where(eq(issues.id, issueId));
    expect((await app.inject({ method: 'PATCH', url: `/api/newsletter/issues/${issueId}`, headers: bearer('editor'), payload: { subject: 'Too late' } })).statusCode).toBe(409);
  });
});

describe('image upload (NWS-05)', () => {
  it('stores PNG, JPEG, GIF or WebP up to 1 MB and serves it publicly', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const uploaded = await app.inject({ method: 'POST', url: '/api/uploads/images', headers: { ...bearer('editor'), 'content-type': 'image/png' }, payload: png });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({ contentType: 'image/png', size: 72, url: expect.stringMatching(/\/api\/public\/images\//) });
    const served = await app.inject({ method: 'GET', url: `/api/public/images/${uploaded.json().id}` });
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.rawPayload.equals(png)).toBe(true);
    const fake = await app.inject({ method: 'POST', url: '/api/uploads/images', headers: { ...bearer('editor'), 'content-type': 'image/png' }, payload: Buffer.from('<svg onload="alert(1)">') });
    expect(fake.json().message).toMatch(/PNG, JPEG/);
    expect((await app.inject({ method: 'POST', url: '/api/uploads/images', headers: { 'content-type': 'image/png' }, payload: png })).statusCode).toBe(401);
  });
});
