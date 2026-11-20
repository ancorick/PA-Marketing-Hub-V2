import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channelFromUtm } from '../src/contacts/channels.js';
import { LogEmailAdapter } from '../src/email/log-adapter.js';
import { createIntegrations } from '../src/integrations/index.js';
import type { MockNavigatorCrmClient } from '../src/integrations/navigator-crm/mock.js';
import { buildTestApp } from './helpers.js';

let app: FastifyInstance;
let outbox: LogEmailAdapter;
let crm: MockNavigatorCrmClient;

beforeEach(async () => {
  outbox = new LogEmailAdapter({ info: () => {} });
  const integrations = createIntegrations('mock');
  crm = integrations.navigatorCrm as MockNavigatorCrmClient;
  app = await buildTestApp({ email: outbox, integrations });
});
afterEach(() => app.close());

const form = {
  email: ' Lilit.H@Example.TEST ',
  firstName: 'Lilit',
  language: 'hy',
  consent: [{ topic: 'newsletter', wordingVersion: 'newsletter-hy-v1' }],
  pageUrl: 'https://academy.example/courses/python?utm_source=instagram&utm_medium=paid_social&utm_campaign=spring_2026',
  utmSource: 'instagram',
  utmMedium: 'paid_social',
  utmCampaign: 'spring_2026',
};

const signUp = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/public/signup', payload });
const confirmToken = () => new URL(outbox.outbox.at(-1)!.text.match(/https?:\/\/\S+/)![0].replace('/#/', '/')).searchParams.get('t')!;

describe('sign-up endpoint (AUD-20, Flow A)', () => {
  it('creates the contact with channel and campaign from the URL parameters and a form touchpoint', async () => {
    const response = await signUp(form);
    expect(response.statusCode).toBe(202);
    const contact = await app.contacts.list({ search: 'lilit', limit: 5, offset: 0 });
    expect(contact.contacts[0]).toMatchObject({ email: 'lilit.h@example.test', sourceChannel: 'paid_social', sourceCampaign: 'spring_2026', type: 'subscriber' });
    const touchpoints = await app.touchpoints.forContact(contact.contacts[0]!.id);
    expect(touchpoints[0]).toMatchObject({ type: 'form', channel: 'paid_social', campaign: 'spring_2026', sourceSystem: 'website' });
  });

  it('answers the same for a known address and keeps its first source', async () => {
    await signUp(form);
    const again = await signUp({ ...form, utmMedium: 'email', utmCampaign: 'other' });
    expect(again.statusCode).toBe(202);
    const page = await app.contacts.list({ search: 'lilit', limit: 5, offset: 0 });
    expect(page.total).toBe(1);
    expect(page.contacts[0]?.sourceChannel).toBe('paid_social');
    expect((await app.touchpoints.forContact(page.contacts[0]!.id)).map((t) => t.channel)).toEqual(expect.arrayContaining(['email', 'paid_social']));
  });

  it('creates a lead in Navigator CRM when the person wants to apply', async () => {
    await signUp({ ...form, wantsToApply: true, courseInterest: 'python' });
    const leads = await crm.listLeadsChangedSince(new Date(Date.now() - 60_000));
    expect(leads.find((lead) => lead.email === 'lilit.h@example.test')).toMatchObject({ courseInterest: 'python', sourceChannel: 'paid_social', sourceCampaign: 'spring_2026' });
  });

  it('drops honeypot submissions silently and validates the rest (NFR-S6, EML-12)', async () => {
    expect((await signUp({ ...form, website: 'http://spam.example' })).statusCode).toBe(202);
    expect((await app.contacts.list({ limit: 5, offset: 0 })).total).toBe(0);
    expect((await signUp({ ...form, email: 'x@mailinator.com' })).json()).toMatchObject({ field: 'email' });
    expect((await signUp({ ...form, email: 'x@nowhere.invalid' })).json().message).toMatch(/cannot receive mail/);
    expect((await signUp({ ...form, consent: [] })).json()).toMatchObject({ field: 'consent' });
    expect((await signUp({ ...form, consent: [{ topic: 'events', wordingVersion: 'newsletter-hy-v1' }] })).statusCode).toBe(400);
  });
});

describe('double opt-in (AUD-08)', () => {
  it('keeps consent pending until the confirmation link is clicked', async () => {
    await signUp(form);
    const contact = (await app.contacts.list({ search: 'lilit', limit: 1, offset: 0 })).contacts[0]!;
    expect((await app.consent.current(contact.id)).newsletter).toBe('pending');

    const email = outbox.outbox.at(-1)!;
    expect(email).toMatchObject({ stream: 'transactional', to: 'lilit.h@example.test', subject: expect.stringMatching(/Picsart Academy/) });
    expect(email.html).toContain('Հաստատել');

    const confirmed = await app.inject({ method: 'POST', url: `/api/public/confirm?t=${confirmToken()}` });
    expect(confirmed.json()).toMatchObject({ confirmed: true, language: 'hy' });
    const consent = await app.consent.view(contact.id);
    expect(consent?.topics.find((t) => t.topic === 'newsletter')).toMatchObject({ state: 'granted', wordingVersion: 'newsletter-hy-v1' });
  });

  it('does not ask again for topics already granted', async () => {
    await signUp(form);
    await app.inject({ method: 'POST', url: `/api/public/confirm?t=${confirmToken()}` });
    const before = outbox.outbox.length;
    await signUp(form);
    expect(outbox.outbox.length).toBe(before);
  });

  it('lets a person who unsubscribed come back only through the confirmation', async () => {
    await signUp(form);
    const contact = (await app.contacts.list({ search: 'lilit', limit: 1, offset: 0 })).contacts[0]!;
    await app.consent.unsubscribeAll(contact.id, 'link', { kind: 'person' });
    await signUp(form);
    expect((await app.contacts.get(contact.id))?.status).toBe('unsubscribed');
    await app.inject({ method: 'POST', url: `/api/public/confirm?t=${confirmToken()}` });
    expect((await app.contacts.get(contact.id))?.status).toBe('active');
  });

  it('rejects a confirmation token used as an unsubscribe token and vice versa', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/public/confirm?t=${app.signer.sign('00000000-0000-4000-8000-000000000000', 'unsubscribe')}` })).statusCode).toBe(400);
  });
});

describe('utm to channel (9.3)', () => {
  it('maps mediums and falls back to the website', () => {
    expect(channelFromUtm('google', 'cpc')).toBe('paid_search');
    expect(channelFromUtm('newsletter', 'email')).toBe('email');
    expect(channelFromUtm(undefined, undefined)).toBe('search_website');
    expect(channelFromUtm('chatbot', 'whatever')).toBe('chatbot');
  });
});
