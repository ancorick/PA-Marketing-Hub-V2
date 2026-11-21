import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { issueComments, issues, newsletterCadences, newsletterTemplates, sends, type NewsletterTemplateRow, type SendRow } from '../db/schema.js';
import type { DomainService } from '../domains/service.js';
import type { EmailAdapter } from '../email/adapter.js';
import { DEFAULT_THEME, type EmailTheme } from '../email/render.js';
import type { SegmentService } from '../segments/service.js';
import { extractUrls } from '../sends/markup.js';
import type { CheckResult, LinkChecker, SendService, SendView, SnapshotBlock } from '../sends/service.js';
import type { UploadService } from '../uploads/service.js';
import { NewsletterError, type IssueView, type NewsletterService } from './service.js';

export type TemplateInput = {
  name: string;
  accentColor: string;
  buttonTextColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  logoUrl: string | null;
  headerText: string;
  footerNote: string | null;
};

/** NWS-09 limits. */
const MAX_SUBJECT = 70;
const MAX_IMAGE_WEIGHT = 1024 * 1024;

/** WCAG 2.1 relative luminance and contrast ratio, for template colours (8.4: contrast meets AA). */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const HEX = /^#[0-9a-fA-F]{6}$/;

type Deps = {
  db: AppPgDatabase;
  newsletter: NewsletterService;
  sends: SendService;
  segments: SegmentService;
  domains: Pick<DomainService, 'list'>;
  email: EmailAdapter;
  uploads: UploadService;
  linkChecker: LinkChecker;
  mailFrom: string;
  now?: () => Date;
};

/**
 * From draft to sent (NWS-08 to NWS-11, NWS-14, NWS-15): templates, pre-send checks, preview and test send,
 * review with comments, approval that freezes the blocks into a send, and the send itself through the email
 * layer to the issue's language segment, honouring suppression and consent.
 */
export class NewsletterPublishing {
  private readonly now: () => Date;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  /* ---------- Templates (NWS-15) ---------- */

  async templates(): Promise<NewsletterTemplateRow[]> {
    return this.deps.db.select().from(newsletterTemplates).orderBy(asc(newsletterTemplates.createdAt));
  }

  async saveTemplate(input: TemplateInput, actorId: string, id?: string): Promise<NewsletterTemplateRow> {
    for (const [field, value] of Object.entries({ accentColor: input.accentColor, buttonTextColor: input.buttonTextColor, backgroundColor: input.backgroundColor, textColor: input.textColor })) {
      if (!HEX.test(value)) throw new NewsletterError('invalid_field', `${field} must be a colour like #FFDC00`);
    }
    if (contrastRatio(input.buttonTextColor, input.accentColor) < 4.5) throw new NewsletterError('invalid_field', 'Button text and button colour need a contrast of at least 4.5:1 (WCAG AA)');
    if (contrastRatio(input.textColor, '#FFFFFF') < 4.5) throw new NewsletterError('invalid_field', 'Body text needs a contrast of at least 4.5:1 on the white email card (WCAG AA)');
    if (input.logoUrl && !/^https:\/\//.test(input.logoUrl)) throw new NewsletterError('invalid_field', 'The logo must be an https:// image');
    const values = { ...input, fontFamily: input.fontFamily.replace(/[;{}<>"]/g, '').slice(0, 200) };
    if (id) {
      const [current] = await this.deps.db.select().from(newsletterTemplates).where(eq(newsletterTemplates.id, id));
      if (!current) throw new NewsletterError('not_found', 'Template not found');
      const [row] = await this.deps.db.update(newsletterTemplates).set({ ...values, version: current.version + 1 }).where(eq(newsletterTemplates.id, id)).returning();
      return row as NewsletterTemplateRow;
    }
    const [row] = await this.deps.db.insert(newsletterTemplates).values({ ...values, createdBy: actorId }).returning();
    return row as NewsletterTemplateRow;
  }

  private async themeFor(issue: IssueView): Promise<EmailTheme> {
    const [cadence] = await this.deps.db.select().from(newsletterCadences).where(eq(newsletterCadences.id, issue.cadenceId));
    const [template] = cadence?.templateId ? await this.deps.db.select().from(newsletterTemplates).where(eq(newsletterTemplates.id, cadence.templateId)) : [];
    return template
      ? { accentColor: template.accentColor, buttonTextColor: template.buttonTextColor, backgroundColor: template.backgroundColor, textColor: template.textColor, fontFamily: template.fontFamily, logoUrl: template.logoUrl, headerText: template.headerText, footerNote: template.footerNote }
      : DEFAULT_THEME;
  }

  /* ---------- Rendering, preview and test (NWS-08) ---------- */

  private async snapshot(issue: IssueView): Promise<SnapshotBlock[]> {
    return (await this.deps.newsletter.blocks(issue.id)).map((block) => ({
      id: block.id,
      title: block.title,
      body: block.body,
      imageUrl: block.imageUrl,
      imageAlt: block.imageAlt,
      buttonLabel: block.buttonLabel,
      buttonUrl: block.buttonUrl,
    }));
  }

  private from() {
    const match = this.deps.mailFrom.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
    return match ? { fromName: match[1] || 'Picsart Academy', fromAddress: (match[2] as string).trim().toLowerCase() } : { fromName: 'Picsart Academy', fromAddress: this.deps.mailFrom.trim().toLowerCase() };
  }

  /** The send that approval would create, for preview and checks before it exists. */
  private async draftSend(issue: IssueView): Promise<SendView> {
    const [cadence] = await this.deps.db.select().from(newsletterCadences).where(eq(newsletterCadences.id, issue.cadenceId));
    const now = this.now().toISOString();
    return {
      id: issue.sendId ?? '00000000-0000-4000-8000-000000000000',
      name: `Newsletter ${issue.edition} (${issue.language})`,
      kind: 'newsletter',
      topic: 'newsletter',
      purpose: 'other',
      includeActiveAdmissions: true,
      segmentId: (cadence?.segments as Record<string, string> | undefined)?.[issue.language] ?? null,
      language: issue.language,
      ...this.from(),
      subject: issue.subject ?? '',
      preheader: issue.preheader,
      body: '',
      buttonLabel: null,
      buttonUrl: null,
      utmCampaign: `newsletter_${issue.edition.replace('-', '_')}_${issue.language}`,
      issueId: issue.id,
      blocks: await this.snapshot(issue),
      theme: (await this.themeFor(issue)) as unknown as Record<string, unknown>,
      status: 'draft',
      pausedReason: null,
      scheduledAt: null,
      approvedBy: null,
      approvedAt: null,
      startedAt: null,
      finishedAt: null,
      sentCount: 0,
      createdBy: 'newsletter',
      createdAt: now,
      updatedAt: now,
    };
  }

  async preview(issueId: string) {
    const issue = await this.deps.newsletter.require(issueId);
    return this.deps.sends.renderFor(await this.draftSend(issue), null);
  }

  async testSend(issueId: string, recipients: string[]): Promise<{ sent: number }> {
    const issue = await this.deps.newsletter.require(issueId);
    const rendered = this.deps.sends.renderFor(await this.draftSend(issue), null);
    for (const to of recipients) {
      await this.deps.email.send({
        idempotencyKey: `test:${issue.id}:${to}:${this.now().getTime()}`,
        stream: 'transactional',
        from: rendered.from,
        to,
        subject: `[Test] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
        headers: rendered.headers,
        tags: { type: 'test_send', issueId: issue.id },
      });
    }
    return { sent: recipients.length };
  }

  /* ---------- Pre-send checks (NWS-09) ---------- */

  async checks(issueId: string): Promise<CheckResult[]> {
    const issue = await this.deps.newsletter.require(issueId);
    const send = await this.draftSend(issue);
    const blocks = send.blocks as SnapshotBlock[];
    const results: CheckResult[] = [];
    const add = (id: string, label: string, status: CheckResult['status'], message: string) => results.push({ id, label, status, message });

    const subject = issue.subject?.trim() ?? '';
    add('subject', 'Subject line', subject && subject.length <= MAX_SUBJECT ? 'pass' : 'fail', !subject ? 'Write a subject line' : `${subject.length} characters (limit ${MAX_SUBJECT})`);
    add('blocks', 'Content', blocks.length > 0 ? 'pass' : 'fail', blocks.length > 0 ? `${blocks.length} blocks` : 'The issue has no blocks');

    const domain = (await this.deps.domains.list()).find((item) => item.domain === send.fromAddress.split('@')[1]);
    add('domain', 'Sending domain', domain?.canSendMarketing ? 'pass' : 'fail', domain ? (domain.canSendMarketing ? `${domain.domain} passes SPF, DKIM and DMARC` : `${domain.domain}: ${domain.blockedReason}`) : `${send.fromAddress.split('@')[1]} (MAIL_FROM) is not a registered sending domain`);

    const breakdown = send.segmentId ? await this.deps.segments.breakdown(send.segmentId, { topic: 'newsletter' }) : null;
    add('audience', 'Audience', breakdown && breakdown.eligible > 0 ? 'pass' : 'fail', breakdown ? `${breakdown.eligible} people with newsletter consent will receive it` : `Choose the ${issue.language} segment in the newsletter schedule`);

    const links = [...new Set(blocks.flatMap((block) => [...extractUrls(block.body).links, ...(block.buttonUrl ? [block.buttonUrl] : [])]))];
    const statuses = await Promise.all(links.map(async (url) => ({ url, status: await this.deps.linkChecker.status(url) })));
    const broken = statuses.filter((item) => item.status !== null && item.status >= 400);
    const unreachable = statuses.filter((item) => item.status === null);
    add('links', 'Broken links', broken.length > 0 ? 'fail' : unreachable.length > 0 ? 'warn' : 'pass', broken.length > 0 ? broken.map((item) => `${item.url} (${item.status})`).join(', ') : unreachable.length > 0 ? `Could not reach: ${unreachable.map((item) => item.url).join(', ')}` : `${links.length} links work`);

    const images = blocks.flatMap((block) => [...(block.imageUrl ? [{ url: block.imageUrl, alt: block.imageAlt ?? '' }] : []), ...extractUrls(block.body).images]);
    const noAlt = images.filter((image) => !image.alt.trim());
    add('alt', 'Image alt text', noAlt.length > 0 ? 'fail' : 'pass', noAlt.length > 0 ? `${noAlt.length} images have no alt text` : `${images.length} images described`);

    let weight = 0;
    const unknown: string[] = [];
    for (const image of images) {
      const size = (await this.deps.uploads.sizeOf(image.url)) ?? (await this.deps.linkChecker.contentLength?.(image.url)) ?? null;
      if (size === null) unknown.push(image.url);
      else weight += size;
    }
    add(
      'weight',
      'Image weight',
      weight > MAX_IMAGE_WEIGHT ? 'fail' : unknown.length > 0 ? 'warn' : 'pass',
      `${Math.round(weight / 1024)} KB of images (limit 1 MB)${unknown.length > 0 ? `; size unknown for ${unknown.length}` : ''}`,
    );

    const rendered = this.deps.sends.renderFor(send, null);
    add('unsubscribe', 'Unsubscribe link and address', rendered.html.includes('/p/unsubscribe') && rendered.headers['List-Unsubscribe'] ? 'pass' : 'fail', 'Footer link, List-Unsubscribe headers, physical address and the reason are in every email');
    return results;
  }

  /* ---------- Review and approval (NWS-10) ---------- */

  async comments(issueId: string) {
    return this.deps.db.select().from(issueComments).where(eq(issueComments.issueId, issueId)).orderBy(asc(issueComments.createdAt));
  }

  async comment(issueId: string, actorId: string, body: string) {
    await this.deps.newsletter.require(issueId);
    await this.deps.db.insert(issueComments).values({ issueId, actorId, kind: 'comment', body });
  }

  async submit(issueId: string, actorId: string, comment: string | null) {
    const issue = await this.deps.newsletter.require(issueId);
    if (issue.status !== 'draft') throw new NewsletterError('invalid_state', `A ${issue.status} issue cannot be submitted`);
    await this.setStatus(issueId, 'in_review');
    await this.deps.db.insert(issueComments).values({ issueId, actorId, kind: 'submitted', body: comment });
    return this.deps.newsletter.require(issueId);
  }

  async requestChanges(issueId: string, actorId: string, comment: string) {
    const issue = await this.deps.newsletter.require(issueId);
    if (!['in_review', 'approved'].includes(issue.status)) throw new NewsletterError('invalid_state', `A ${issue.status} issue is not waiting for review`);
    await this.setStatus(issueId, 'draft');
    await this.deps.db.insert(issueComments).values({ issueId, actorId, kind: 'changes_requested', body: comment });
    return this.deps.newsletter.require(issueId);
  }

  /**
   * Manager approval (NWS-10, story NWS-S2): only when every check passes. The approved blocks and template
   * are frozen into a newsletter send, scheduled for `at` or the planned send date (NWS-11).
   */
  async approve(issueId: string, actorId: string, comment: string | null, at: Date | null) {
    const issue = await this.deps.newsletter.require(issueId);
    if (!['draft', 'in_review'].includes(issue.status)) throw new NewsletterError('invalid_state', `A ${issue.status} issue cannot be approved`);
    const failed = (await this.checks(issueId)).filter((check) => check.status === 'fail');
    if (failed.length > 0) throw new NewsletterError('invalid_state', `Fix before approving: ${failed.map((check) => check.label).join(', ')}`);
    const draft = await this.draftSend(issue);
    const when = at ?? new Date(Math.max(new Date(issue.plannedSendAt).getTime(), this.now().getTime()));
    const send = await this.deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(sends)
        .values({
          name: draft.name,
          kind: 'newsletter',
          topic: 'newsletter',
          purpose: 'other',
          includeActiveAdmissions: true,
          segmentId: draft.segmentId,
          language: draft.language,
          fromName: draft.fromName,
          fromAddress: draft.fromAddress,
          subject: draft.subject,
          preheader: draft.preheader,
          body: '',
          utmCampaign: draft.utmCampaign,
          issueId: issue.id,
          blocks: draft.blocks,
          theme: draft.theme,
          status: 'scheduled',
          scheduledAt: when,
          approvedBy: actorId,
          approvedAt: this.now(),
          createdBy: actorId,
        })
        .returning();
      await tx.update(issues).set({ status: 'scheduled', sendId: (row as SendRow).id }).where(eq(issues.id, issueId));
      await tx.insert(issueComments).values({ issueId, actorId, kind: 'approved', body: comment });
      return row as SendRow;
    });
    return { issue: await this.deps.newsletter.require(issueId), sendId: send.id, scheduledAt: when.toISOString() };
  }

  /** Takes a scheduled issue off the schedule to edit it; it needs approval again. */
  async unschedule(issueId: string, actorId: string) {
    const issue = await this.deps.newsletter.require(issueId);
    if (issue.status !== 'scheduled' || !issue.sendId) throw new NewsletterError('invalid_state', 'Only a scheduled issue can be unscheduled');
    const send = await this.deps.sends.require(issue.sendId);
    if (send.status !== 'scheduled') throw new NewsletterError('invalid_state', 'Sending has started; pause or cancel it on the campaign screen');
    await this.deps.sends.cancel(send.id);
    await this.deps.db.update(issues).set({ status: 'in_review', sendId: null }).where(eq(issues.id, issueId));
    await this.deps.db.insert(issueComments).values({ issueId, actorId, kind: 'unscheduled', body: null });
    return this.deps.newsletter.require(issueId);
  }

  /** Marks issues sent once their send finished (run by the newsletter job). */
  async syncSent(): Promise<string[]> {
    const scheduled = await this.deps.db.select().from(issues).where(eq(issues.status, 'scheduled'));
    const sendIds = scheduled.map((issue) => issue.sendId).filter((id): id is string => Boolean(id));
    if (sendIds.length === 0) return [];
    const finished = await this.deps.db.select({ id: sends.id }).from(sends).where(and(inArray(sends.id, sendIds), eq(sends.status, 'sent')));
    const done = scheduled.filter((issue) => finished.some((send) => send.id === issue.sendId)).map((issue) => issue.id);
    for (const id of done) await this.setStatus(id, 'sent');
    return done;
  }

  private async setStatus(issueId: string, status: string) {
    await this.deps.db.update(issues).set({ status }).where(eq(issues.id, issueId));
  }
}
