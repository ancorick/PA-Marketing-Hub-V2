import type { EmailMessage } from '../email/adapter.js';
import type { LogEmailAdapter } from '../email/log-adapter.js';

const MINUTE = 60_000;

const page = (title: string, body: string, button?: { label: string; url: string }) =>
  `<!doctype html><html lang="en"><body style="margin:0;background:#f6f5fa;font-family:Manrope,Arial,sans-serif;color:#121216">` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">` +
  `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:32px;max-width:600px">` +
  `<tr><td><p style="margin:0 0 8px;font-weight:700;color:#5b5b66">Picsart Academy</p><h1 style="margin:0 0 16px;font-size:22px">${title}</h1>${body}` +
  (button ? `<p style="margin:24px 0"><a href="${button.url}" style="background:#ffdc00;color:#131317;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700">${button.label}</a></p>` : '') +
  `<p style="margin:24px 0 0;font-size:12px;color:#5b5b66">Demo message. <a href="https://academy.example.test/unsubscribe">Unsubscribe</a> · <a href="https://academy.example.test/preferences">Preferences</a></p>` +
  `</td></tr></table></td></tr></table></body></html>`;

type Draft = { minutesAgo: number; message: Omit<EmailMessage, 'idempotencyKey' | 'html' | 'text'> & { html: string; text: string } };

const FROM_MARKETING = 'Picsart Academy <news@news.academy-domain.example>';
const FROM_TRANSACTIONAL = 'Picsart Academy <hello@mail.academy-domain.example>';
const LIST_HEADERS = { 'List-Unsubscribe': '<https://academy.example.test/unsubscribe>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };

const DRAFTS: Draft[] = [
  {
    minutesAgo: 9,
    message: {
      stream: 'transactional',
      from: FROM_TRANSACTIONAL,
      to: 'demo.anna@mail.example',
      subject: 'Confirm your subscription to Picsart Academy news',
      html: page('Confirm your subscription', '<p>You asked to receive Academy news. Confirm your address so we know it is yours.</p>', { label: 'Confirm subscription', url: 'https://academy.example.test/confirm/demo' }),
      text: 'Confirm your subscription: https://academy.example.test/confirm/demo',
    },
  },
  {
    minutesAgo: 6,
    message: {
      stream: 'transactional',
      from: FROM_TRANSACTIONAL,
      to: 'demo.levon@mail.example',
      subject: 'Welcome to Picsart Academy',
      html: page('Welcome', '<p>Thank you for subscribing. Once a month you get what happened at the Academy: events, new Library items, graduations and alumni hires.</p>'),
      text: 'Welcome to Picsart Academy. Once a month you get what happened at the Academy.',
    },
  },
  {
    minutesAgo: 3 * 60,
    message: {
      stream: 'marketing',
      from: FROM_MARKETING,
      to: 'seed.manager@academy.example',
      subject: '[Test] Winter workshops are open for registration',
      html: page('Winter workshops are open', '<p>Four evenings, four skills. Join our winter workshops.</p>', { label: 'Register', url: 'https://academy.example.test/workshops' }),
      text: 'Winter workshops are open for registration: https://academy.example.test/workshops',
      headers: LIST_HEADERS,
    },
  },
  {
    minutesAgo: 26 * 60,
    message: {
      stream: 'marketing',
      from: FROM_MARKETING,
      to: 'seed.editor@academy.example',
      subject: '[Test] Ակադեմիայի տեղեկագիր · 2026-12',
      html: page('Այս ամիս Ակադեմիայում', '<p>Շրջանավարտների հանդիպում, նոր ռեսուրսներ գրադարանում և նոր խմբեր։</p>', { label: 'Կարդալ ավելին', url: 'https://academy.example.test/newsletter' }),
      text: 'Այս ամիս Ակադեմիայում։ https://academy.example.test/newsletter',
      headers: LIST_HEADERS,
    },
  },
  {
    minutesAgo: 27 * 60,
    message: {
      stream: 'marketing',
      from: FROM_MARKETING,
      to: 'bounce.check@mail.example',
      subject: '[Test] Open day invitation',
      html: page('Open day invitation', '<p>You came to an open day: the next groups start in January.</p>', { label: 'Apply', url: 'https://academy.example.test/apply' }),
      text: 'Open day invitation: https://academy.example.test/apply',
      headers: LIST_HEADERS,
    },
  },
];

/** Demo mode only: a few messages in the Dev inbox so the page has something to show before anything is sent. */
export function seedDemoInbox(adapter: LogEmailAdapter, now: Date = new Date()) {
  if (adapter.inbox.length > 0) return 0;
  DRAFTS.forEach((draft, index) => {
    const at = new Date(now.getTime() - draft.minutesAgo * MINUTE);
    adapter.record(`demo-inbox-${index + 1}`, at, { ...draft.message, idempotencyKey: `demo-inbox-${index + 1}` });
  });
  return DRAFTS.length;
}
