import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Topic } from '../consent/wordings.js';
import type { Contact } from '../contacts/repository.js';
import type { AppPgDatabase } from '../db/client.js';
import { contacts, deliveries, sends, type DeliveryRow, type SendRow } from '../db/schema.js';
import type { DomainService } from '../domains/service.js';
import type { EmailAdapter } from '../email/adapter.js';
import { escapeHtml, renderEmail, type EmailTheme } from '../email/render.js';
import type { Language } from '../integrations/core-engine/contract.js';
import type { ContactLinks, LinkSigner } from '../links/tokens.js';
import type { SegmentService } from '../segments/service.js';
import { extractUrls, renderMarkup, tagUrl } from './markup.js';

export type SendStatus = 'draft' | 'approved' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'cancelled';
export type SendKind = 'campaign' | 'newsletter' | 'reengagement';

export type SendInput = {
  name: string;
  kind?: SendKind;
  topic: Topic;
  purpose?: 'recruitment' | 'other';
  includeActiveAdmissions?: boolean;
  segmentId: string | null;
  language: Language;
  fromName: string;
  fromAddress: string;
  subject: string;
  preheader?: string | null;
  body: string;
  buttonLabel?: string | null;
  buttonUrl?: string | null;
  utmCampaign?: string | null;
};

export class SendError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_state' | 'checks_failed' | 'invalid_field',
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'SendError';
  }
}

/** A newsletter block as frozen into the send at approval. */
export type SnapshotBlock = {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  imageAlt: string | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
};

export type CheckResult = { id: string; label: string; status: 'pass' | 'warn' | 'fail'; message: string };

/** Link reachability for pre-send checks; injectable so tests never hit the network. */
export interface LinkChecker {
  /** HTTP status, or null when the request failed (timeout, DNS). */
  status(url: string): Promise<number | null>;
  /** Content-Length in bytes for image weight checks (NWS-09); null when unknown. */
  contentLength?(url: string): Promise<number | null>;
}

export const httpLinkChecker: LinkChecker = {
  async status(url) {
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
      if (response.status === 405) return (await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(5000) })).status;
      return response.status;
    } catch {
      return null;
    }
  },
  async contentLength(url) {
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
      const length = Number(response.headers.get('content-length'));
      return response.ok && Number.isFinite(length) && length > 0 ? length : null;
    } catch {
      return null;
    }
  },
};

const FALLBACK_NAME: Record<Language, string> = { en: 'friend', hy: 'ընկեր', ru: 'друг' };

const TOPIC_NAME: Record<Language, Record<Topic, string>> = {
  en: { newsletter: 'the newsletter', courses: 'course news', events: 'event invitations', alumni: 'alumni news' },
  hy: { newsletter: 'տեղեկագրին', courses: 'դասընթացների նորություններին', events: 'միջոցառումների հրավերներին', alumni: 'շրջանավարտների նորություններին' },
  ru: { newsletter: 'рассылку', courses: 'новости о курсах', events: 'приглашения на мероприятия', alumni: 'новости выпускников' },
};

/** NFR-P3: every marketing email says why the person receives it. */
const REASON: Record<Language, (topic: Topic) => string> = {
  en: (topic) => `You receive this email because you subscribed to ${TOPIC_NAME.en[topic]} from Picsart Academy.`,
  hy: (topic) => `Ստանում եք այս նամակը, քանի որ բաժանորդագրվել եք Picsart Academy-ի ${TOPIC_NAME.hy[topic]}։`,
  ru: (topic) => `Вы получили это письмо, потому что подписались на ${TOPIC_NAME.ru[topic]} Picsart Academy.`,
};

/** Gmail clips messages over ~102 KB, hiding the footer and its unsubscribe link. */
const MAX_HTML_BYTES = 100 * 1024;

export type SendView = Omit<SendRow, 'scheduledAt' | 'approvedAt' | 'startedAt' | 'finishedAt' | 'createdAt' | 'updatedAt'> & {
  status: SendStatus;
  scheduledAt: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const iso = (value: Date | null) => value?.toISOString() ?? null;
const toView = (row: SendRow): SendView => ({
  ...row,
  status: row.status as SendStatus,
  scheduledAt: iso(row.scheduledAt),
  approvedAt: iso(row.approvedAt),
  startedAt: iso(row.startedAt),
  finishedAt: iso(row.finishedAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'campaign';

type SendServiceDeps = {
  db: AppPgDatabase;
  segments: SegmentService;
  domains: Pick<DomainService, 'list'>;
  email: EmailAdapter;
  links: ContactLinks;
  signer: LinkSigner;
  linkChecker: LinkChecker;
  postalAddress: string;
  now?: () => Date;
};

/** Campaign sends (Flow B, PRD 13.2): draft, checks, test send, approval, schedule, and their log (EML-16). */
export class SendService {
  private readonly now: () => Date;

  constructor(private readonly deps: SendServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async list(): Promise<SendView[]> {
    return (await this.deps.db.select().from(sends).orderBy(desc(sends.updatedAt))).map(toView);
  }

  async get(id: string): Promise<SendView | null> {
    const [row] = await this.deps.db.select().from(sends).where(eq(sends.id, id));
    return row ? toView(row) : null;
  }

  async create(input: SendInput, actorId: string): Promise<SendView> {
    this.validate(input);
    const [row] = await this.deps.db
      .insert(sends)
      .values({ ...this.values(input), createdBy: actorId })
      .returning();
    return toView(row as SendRow);
  }

  /** Content changes after approval send the campaign back to draft: it must be approved again. */
  async update(id: string, input: SendInput): Promise<SendView> {
    const send = await this.require(id);
    if (!['draft', 'approved'].includes(send.status)) throw new SendError('invalid_state', `A ${send.status} send cannot be edited`);
    this.validate(input);
    const [row] = await this.deps.db
      .update(sends)
      .set({ ...this.values(input), status: 'draft', approvedBy: null, approvedAt: null })
      .where(eq(sends.id, id))
      .returning();
    return toView(row as SendRow);
  }

  async remove(id: string): Promise<void> {
    const send = await this.require(id);
    if (send.status !== 'draft') throw new SendError('invalid_state', 'Only drafts can be deleted; cancel a scheduled send instead');
    await this.deps.db.delete(sends).where(eq(sends.id, id));
  }

  /** Renders the email as one contact will see it (EML-11): personalized, tagged links, unsubscribe footer and headers. */
  renderFor(send: SendView, contact: Pick<Contact, 'id' | 'firstName'> | null) {
    const language = send.language as Language;
    const contactId = contact?.id ?? '00000000-0000-4000-8000-000000000000';
    const token = contact ? this.deps.signer.sign(contact.id, 'track') : undefined;
    const source = send.kind === 'newsletter' ? 'newsletter' : 'campaign';
    const tag = (url: string) => tagUrl(url, { source, campaign: send.utmCampaign, token });
    const name = contact?.firstName ?? FALLBACK_NAME[language];
    const personalize = (value: string) => value.replace(/\{\{\s*first_name\s*\}\}/g, name);
    // Newsletters render their approved blocks, each link tagged with its block (NWS-14).
    const blocks = send.blocks
      ? (send.blocks as SnapshotBlock[]).map((block) => {
          const blockTag = (url: string) => tagUrl(url, { source, campaign: send.utmCampaign, token, content: block.id });
          const inner = renderMarkup(personalize(block.body), blockTag);
          const image = block.imageUrl
            ? `<img src="${escapeHtml(block.imageUrl)}" alt="${escapeHtml(block.imageAlt ?? '')}" width="536" style="display:block;max-width:100%;height:auto;border-radius:12px;margin:0 0 16px;">`
            : '';
          const button =
            block.buttonLabel && block.buttonUrl
              ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(blockTag(block.buttonUrl))}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:${(send.theme as EmailTheme | null)?.accentColor ?? '#FFDC00'};color:${(send.theme as EmailTheme | null)?.buttonTextColor ?? '#131317'};font-weight:700;text-decoration:none;">${escapeHtml(block.buttonLabel)}</a></p>`
              : '';
          return {
            html: `<h2 style="margin:24px 0 12px;font-size:20px;line-height:1.3;">${escapeHtml(block.title)}</h2>\n${image}\n${inner.html}\n${button}`,
            text: [block.title.toUpperCase(), inner.text, ...(block.buttonLabel && block.buttonUrl ? [`${block.buttonLabel}: ${blockTag(block.buttonUrl)}`] : [])].join('\n\n'),
          };
        })
      : [renderMarkup(personalize(send.body), tag)];
    const body = blocks;
    const rendered = renderEmail({
      ...(send.theme && { theme: send.theme as EmailTheme }),
      language,
      preheader: send.preheader ?? undefined,
      title: personalize(send.subject),
      blocks: body,
      ...(send.kind === 'reengagement' && send.buttonLabel
        ? // EML-15: "Keep me subscribed" opens the person's own preferences link, which records the answer.
          { button: { label: send.buttonLabel, url: `${this.deps.links.preferencesPage(contactId)}&stay=1` } }
        : send.buttonLabel && send.buttonUrl && { button: { label: send.buttonLabel, url: tag(send.buttonUrl) } }),
      footer: {
        reason: REASON[language](send.topic as Topic),
        postalAddress: this.deps.postalAddress,
        unsubscribeUrl: this.deps.links.unsubscribePage(contactId, send.id),
        preferencesUrl: this.deps.links.preferencesPage(contactId),
      },
    });
    return {
      from: `${send.fromName} <${send.fromAddress}>`,
      subject: personalize(send.subject),
      html: rendered.html,
      text: rendered.text,
      headers: this.deps.links.unsubscribeHeaders(contactId, send.id),
    };
  }

  async preview(id: string) {
    const send = await this.require(id);
    const [sample] = send.segmentId ? (await this.deps.segments.audience(send.segmentId, this.audienceOptions(send))).slice(0, 1) : [];
    return this.renderFor(send, sample ?? null);
  }

  /** Pre-send checks (Flow B step 3): failures block approval, warnings are shown. */
  async checks(id: string): Promise<CheckResult[]> {
    const send = await this.require(id);
    const results: CheckResult[] = [];
    const add = (id: string, label: string, status: CheckResult['status'], message: string) => results.push({ id, label, status, message });

    add('subject', 'Subject line', send.subject.trim() ? (send.subject.length > 90 ? 'warn' : 'pass') : 'fail', send.subject.length > 90 ? 'Long subjects are cut off on phones' : send.subject.trim() ? 'OK' : 'Write a subject line');

    const domains = await this.deps.domains.list();
    const fromDomain = send.fromAddress.split('@')[1]?.toLowerCase() ?? '';
    const domain = domains.find((item) => item.domain === fromDomain);
    add(
      'domain',
      'Sending domain',
      domain?.canSendMarketing ? 'pass' : 'fail',
      domain ? (domain.canSendMarketing ? `${domain.domain} passes SPF, DKIM and DMARC` : `${domain.domain}: ${domain.blockedReason}`) : `${fromDomain || 'The From address'} is not a registered sending domain`,
    );

    const breakdown = send.segmentId ? await this.deps.segments.breakdown(send.segmentId, this.audienceOptions(send)) : null;
    add('audience', 'Audience', breakdown && breakdown.eligible > 0 ? 'pass' : 'fail', breakdown ? `${breakdown.eligible} people will receive it` : 'Choose a segment');

    const { links, images } = extractUrls(send.body);
    const urls = [...links, ...(send.buttonUrl ? [send.buttonUrl] : [])];
    const statuses = await Promise.all(urls.map(async (url) => ({ url, status: await this.deps.linkChecker.status(url) })));
    const broken = statuses.filter((item) => item.status !== null && item.status >= 400);
    const unreachable = statuses.filter((item) => item.status === null);
    add(
      'links',
      'Links',
      broken.length > 0 ? 'fail' : unreachable.length > 0 ? 'warn' : 'pass',
      broken.length > 0
        ? `Broken: ${broken.map((item) => `${item.url} (${item.status})`).join(', ')}`
        : unreachable.length > 0
          ? `Could not reach: ${unreachable.map((item) => item.url).join(', ')}`
          : `${urls.length} links work`,
    );
    const missingAlt = images.filter((image) => !image.alt);
    add('alt', 'Image alt text', missingAlt.length > 0 ? 'fail' : 'pass', missingAlt.length > 0 ? `${missingAlt.length} images have no alt text` : 'OK');

    const rendered = this.renderFor(send, null);
    const bytes = Buffer.byteLength(rendered.html);
    add('size', 'Email size', bytes > MAX_HTML_BYTES ? 'fail' : 'pass', `${Math.round(bytes / 1024)} KB of HTML (limit ${MAX_HTML_BYTES / 1024} KB)`);
    add(
      'unsubscribe',
      'Unsubscribe link and address',
      rendered.html.includes('/p/unsubscribe') && rendered.headers['List-Unsubscribe'] ? 'pass' : 'fail',
      'Footer link, List-Unsubscribe headers and the physical address are added to every email',
    );
    return results;
  }

  /** EML-13: a test to the seed list, marked as a test, outside the send log and the warm-up count. */
  async testSend(id: string, recipients: string[]): Promise<{ sent: number }> {
    const send = await this.require(id);
    const rendered = this.renderFor(send, null);
    for (const to of recipients) {
      await this.deps.email.send({
        idempotencyKey: `test:${send.id}:${to}:${this.now().getTime()}`,
        stream: 'transactional',
        from: rendered.from,
        to,
        subject: `[Test] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
        headers: rendered.headers,
        tags: { type: 'test_send', sendId: send.id },
      });
    }
    return { sent: recipients.length };
  }

  /** Approval by a marketing manager or admin (PRD 4.3, Flow B step 4); schedules it for `at` or now. */
  async approve(id: string, actorId: string, at: Date | null): Promise<SendView> {
    const send = await this.require(id);
    if (!['draft', 'approved'].includes(send.status)) throw new SendError('invalid_state', `A ${send.status} send cannot be approved`);
    const failed = (await this.checks(id)).filter((check) => check.status === 'fail');
    if (failed.length > 0) throw new SendError('checks_failed', `Fix before approving: ${failed.map((check) => check.label).join(', ')}`);
    const [row] = await this.deps.db
      .update(sends)
      .set({ status: 'scheduled', approvedBy: actorId, approvedAt: this.now(), scheduledAt: at ?? this.now() })
      .where(eq(sends.id, id))
      .returning();
    return toView(row as SendRow);
  }

  async pause(id: string, reason: string): Promise<SendView> {
    const send = await this.require(id);
    if (!['scheduled', 'sending'].includes(send.status)) throw new SendError('invalid_state', `A ${send.status} send cannot be paused`);
    return this.setStatus(id, { status: 'paused', pausedReason: reason });
  }

  async resume(id: string): Promise<SendView> {
    const send = await this.require(id);
    if (send.status !== 'paused') throw new SendError('invalid_state', 'Only paused sends can be resumed');
    return this.setStatus(id, { status: send.startedAt ? 'sending' : 'scheduled', pausedReason: null });
  }

  /** Stops a send; messages already handed to the ESP stay sent, the rest are skipped. */
  async cancel(id: string): Promise<SendView> {
    const send = await this.require(id);
    if (['sent', 'cancelled'].includes(send.status)) throw new SendError('invalid_state', `A ${send.status} send cannot be cancelled`);
    await this.deps.db
      .update(deliveries)
      .set({ status: 'skipped', skipReason: 'cancelled' })
      .where(and(eq(deliveries.sendId, id), eq(deliveries.status, 'queued')));
    return this.setStatus(id, { status: 'cancelled', finishedAt: this.now() });
  }

  /** Delivery counts by status (the send report; opens are estimated, PRD 7.5). */
  async report(id: string) {
    await this.require(id);
    const rows = await this.deps.db
      .select({ status: deliveries.status, value: count() })
      .from(deliveries)
      .where(eq(deliveries.sendId, id))
      .groupBy(deliveries.status);
    const [engagement] = await this.deps.db
      .select({
        opened: sql<number>`count(${deliveries.openedAt})`,
        clicked: sql<number>`count(${deliveries.firstClickAt})`,
        unsubscribed: sql<number>`count(${deliveries.unsubscribedAt})`,
      })
      .from(deliveries)
      .where(eq(deliveries.sendId, id));
    return {
      byStatus: Object.fromEntries(rows.map((row) => [row.status, row.value])) as Record<string, number>,
      openedEstimated: Number(engagement?.opened ?? 0),
      clicked: Number(engagement?.clicked ?? 0),
      unsubscribed: Number(engagement?.unsubscribed ?? 0),
    };
  }

  /** Send log (EML-16): per message contact, time, ESP message ID and final status. */
  async log(id: string, page: { limit: number; offset: number; status?: string }) {
    await this.require(id);
    const where = page.status ? and(eq(deliveries.sendId, id), eq(deliveries.status, page.status)) : eq(deliveries.sendId, id);
    const [rows, [total]] = await Promise.all([
      this.deps.db
        .select({ delivery: deliveries, firstName: contacts.firstName, lastName: contacts.lastName })
        .from(deliveries)
        .leftJoin(contacts, eq(deliveries.contactId, contacts.id))
        .where(where)
        .orderBy(desc(deliveries.sentAt), desc(deliveries.createdAt))
        .limit(page.limit)
        .offset(page.offset),
      this.deps.db.select({ value: count() }).from(deliveries).where(where),
    ]);
    return {
      total: total?.value ?? 0,
      deliveries: rows.map(({ delivery, firstName, lastName }) => ({ ...logView(delivery), name: [firstName, lastName].filter(Boolean).join(' ') || null })),
    };
  }

  audienceOptions(send: Pick<SendView, 'topic' | 'purpose' | 'includeActiveAdmissions'>) {
    return { topic: send.topic as Topic, excludeActiveAdmissions: send.purpose === 'recruitment' && !send.includeActiveAdmissions };
  }

  async require(id: string): Promise<SendView> {
    const send = await this.get(id);
    if (!send) throw new SendError('not_found', 'Send not found');
    return send;
  }

  async setStatus(id: string, values: Partial<typeof sends.$inferInsert>): Promise<SendView> {
    const [row] = await this.deps.db.update(sends).set(values).where(eq(sends.id, id)).returning();
    return toView(row as SendRow);
  }

  async byIds(ids: string[]) {
    return ids.length === 0 ? [] : (await this.deps.db.select().from(sends).where(inArray(sends.id, ids))).map(toView);
  }

  private validate(input: SendInput) {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.fromAddress)) throw new SendError('invalid_field', 'Enter a From address such as news@news.academy-domain.am', 'fromAddress');
    for (const url of [...extractUrls(input.body).links, ...(input.buttonUrl ? [input.buttonUrl] : [])]) {
      if (!/^https?:\/\//.test(url)) throw new SendError('invalid_field', `Links must start with https:// (${url})`, 'body');
    }
    if (Boolean(input.buttonLabel) !== Boolean(input.buttonUrl)) throw new SendError('invalid_field', 'A button needs both a label and a link', 'buttonUrl');
  }

  private values(input: SendInput) {
    return {
      name: input.name.trim(),
      kind: input.kind ?? 'campaign',
      topic: input.topic,
      purpose: input.purpose ?? 'other',
      includeActiveAdmissions: input.includeActiveAdmissions ?? false,
      segmentId: input.segmentId,
      language: input.language,
      fromName: input.fromName.trim(),
      fromAddress: input.fromAddress.trim().toLowerCase(),
      subject: input.subject.trim(),
      preheader: input.preheader?.trim() || null,
      body: input.body,
      buttonLabel: input.buttonLabel?.trim() || null,
      buttonUrl: input.buttonUrl?.trim() || null,
      utmCampaign: slug(input.utmCampaign?.trim() || input.name),
    };
  }
}

export const logView = (delivery: DeliveryRow) => ({
  id: delivery.id,
  contactId: delivery.contactId,
  email: delivery.email,
  status: delivery.status,
  skipReason: delivery.skipReason,
  attempts: delivery.attempts,
  lastError: delivery.lastError,
  espMessageId: delivery.espMessageId,
  sentAt: iso(delivery.sentAt),
  deliveredAt: iso(delivery.deliveredAt),
  openedAt: iso(delivery.openedAt),
  firstClickAt: iso(delivery.firstClickAt),
});
