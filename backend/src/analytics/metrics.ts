import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { DuplicateService } from '../contacts/duplicates.js';
import type { AppPgDatabase } from '../db/client.js';
import { consentRecords, contacts, deliveries, dmarcRecords, dmarcReports, issueComments, issueEdits, issues, sends, staffActivity } from '../db/schema.js';
import type { AttributionService } from './attribution.js';
import type { DataHealth } from './health.js';

export type MetricStatus = 'meets' | 'misses' | 'no_data';
export type Metric = { id: string; name: string; value: string; target: string; status: MetricStatus; detail: string; source: string };

const DAY = 86_400_000;
const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

/** ISO week of a date, e.g. 2026-W47 (M11). */
export function isoWeek(at: Date): string {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The last full calendar quarter before `now` (M1). */
export function lastFullQuarter(now: Date) {
  const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  const end = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/**
 * Success metrics M1–M11 (PRD 3.2) measured from Marketing Hub's own data, for the final acceptance (17.1).
 * Each says how it is measured; "no data" means nothing to measure yet (for example no send so far).
 */
export class ProgramMetrics {
  constructor(
    private readonly deps: {
      db: AppPgDatabase;
      attribution: AttributionService;
      health: DataHealth;
      duplicates: Pick<DuplicateService, 'suggestions'>;
      now?: () => Date;
    },
  ) {}

  /** M11: called when a staff member opens the Overview. */
  async recordView(userId: string, role: string) {
    await this.deps.db
      .insert(staffActivity)
      .values({ userId, week: isoWeek(this.now()), role })
      .onConflictDoUpdate({ target: [staffActivity.userId, staffActivity.week], set: { views: sql`${staffActivity.views} + 1`, role } });
  }

  async all(): Promise<Metric[]> {
    return Promise.all([this.m1(), this.m2(), this.m3(), this.m4(), this.m5(), this.m6(), ...(await this.m7m8()), this.m9(), this.m10(), this.m11()]);
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private async m1(): Promise<Metric> {
    const quarter = lastFullQuarter(this.now());
    const rows = await this.deps.attribution.byChannel(quarter, 'first_touch');
    const enrolled = rows.reduce((sum, row) => sum + row.enrolled, 0);
    const known = rows.filter((row) => row.channel !== 'unattributed' && row.channel !== 'unmapped').reduce((sum, row) => sum + row.enrolled, 0);
    const base = { id: 'M1', name: 'Attributed enrollment coverage', target: '90% or more', source: `Enrolled in ${quarter.from} to ${quarter.to} with a known first-touch channel` };
    if (enrolled === 0) return { ...base, value: '—', status: 'no_data', detail: 'No enrollments in the last full quarter' };
    return { ...base, value: pct(known / enrolled), status: known / enrolled >= 0.9 ? 'meets' : 'misses', detail: `${Math.round(known)} of ${Math.round(enrolled)} enrolled students` };
  }

  private async m2(): Promise<Metric> {
    const report = await this.deps.health.report();
    const now = this.now().getTime();
    const late = report.sources.filter((source) => {
      if (!source.lastSuccessAt) return true;
      const hours = (now - Date.parse(source.lastSuccessAt)) / 3_600_000;
      return hours > (source.kind === 'internal' ? 1 : 24);
    });
    const base = { id: 'M2', name: 'Dashboard freshness', target: 'Under 24 h for every source; under 1 h for internal sources', source: 'Data Health (last successful pull per source)' };
    if (report.sources.every((source) => !source.lastSuccessAt)) return { ...base, value: '—', status: 'no_data', detail: 'No source has been pulled yet' };
    return { ...base, value: `${report.sources.length - late.length} of ${report.sources.length} fresh`, status: late.length ? 'misses' : 'meets', detail: late.length ? `Late: ${late.map((source) => source.name).join(', ')}` : 'All sources within target' };
  }

  private async m3(): Promise<Metric> {
    const [row] = await this.deps.db.select({ n: sql<number>`count(*)` }).from(contacts).where(sql`${contacts.status} <> 'erased'`);
    const total = Number(row?.n ?? 0);
    const pairs = await this.deps.duplicates.suggestions(10_000);
    const base = { id: 'M3', name: 'Duplicate contact rate', target: 'Under 1%', source: 'Open duplicate suggestions (AUD-04)' };
    if (total === 0) return { ...base, value: '—', status: 'no_data', detail: 'No contacts yet' };
    // Each open pair is one record too many (an upper bound when three records are the same person).
    const rate = pairs.length / total;
    return { ...base, value: pct(rate, 2), status: rate < 0.01 ? 'meets' : 'misses', detail: `${pairs.length} suggested pairs among ${total} contacts` };
  }

  private async m4(): Promise<Metric> {
    const since = new Date(this.now().getTime() - 90 * DAY);
    const recipients = await this.deps.db
      .selectDistinct({ contactId: deliveries.contactId })
      .from(deliveries)
      // Sends are marketing only; transactional mail does not go through them.
      .where(and(isNotNull(deliveries.sentAt), gte(deliveries.sentAt, since)));
    const ids = recipients.map((row) => row.contactId).filter((id): id is string => id !== null);
    const base = { id: 'M4', name: 'Consent coverage', target: '100% of contacts who receive marketing email', source: 'Recipients of marketing email in the last 90 days with a consent record (state, date, source)' };
    if (ids.length === 0) return { ...base, value: '—', status: 'no_data', detail: 'No marketing email sent in the last 90 days' };
    const covered = await this.deps.db.selectDistinct({ contactId: consentRecords.contactId }).from(consentRecords).where(and(inArray(consentRecords.contactId, ids), eq(consentRecords.state, 'granted')));
    const rate = covered.length / ids.length;
    return { ...base, value: pct(rate), status: rate === 1 ? 'meets' : 'misses', detail: `${covered.length} of ${ids.length} recipients` };
  }

  private async m5(): Promise<Metric> {
    const since = new Date(this.now().getTime() - 30 * DAY);
    const [row] = await this.deps.db
      .select({
        n: sql<number>`count(*)`,
        worst: sql<number>`coalesce(max(extract(epoch from (${contacts.updatedAt} - ${deliveries.unsubscribedAt}))), 0)`,
      })
      .from(deliveries)
      .innerJoin(contacts, eq(deliveries.contactId, contacts.id))
      .where(and(gte(deliveries.unsubscribedAt, since), eq(contacts.status, 'unsubscribed')));
    const base = { id: 'M5', name: 'Unsubscribe latency', target: 'Under 1 minute', source: 'Suppression is written in the same request as the click; worst case over the last 30 days' };
    const count = Number(row?.n ?? 0);
    if (count === 0) return { ...base, value: 'Immediate', status: 'meets', detail: 'No unsubscribes from email in the last 30 days; suppression is synchronous (tests: public-preferences, sends)' };
    const seconds = Math.max(0, Number(row?.worst ?? 0));
    return { ...base, value: seconds < 1 ? 'Immediate' : `${Math.round(seconds)} s`, status: seconds < 60 ? 'meets' : 'misses', detail: `${count} unsubscribes in the last 30 days` };
  }

  private async m6(): Promise<Metric> {
    const since = new Date(this.now().getTime() - 30 * DAY);
    const [row] = await this.deps.db
      .select({ total: sql<number>`coalesce(sum(${dmarcRecords.count}), 0)`, passed: sql<number>`coalesce(sum(${dmarcRecords.count}) filter (where ${dmarcRecords.dkim} = 'pass' or ${dmarcRecords.spf} = 'pass'), 0)` })
      .from(dmarcRecords)
      .innerJoin(dmarcReports, eq(dmarcRecords.reportId, dmarcReports.id))
      .where(gte(dmarcReports.dateEnd, since));
    const total = Number(row?.total ?? 0);
    const base = { id: 'M6', name: 'Authentication pass rate', target: '99% or more', source: 'DMARC aggregate reports of the last 30 days (EML-07)' };
    if (total === 0) return { ...base, value: '—', status: 'no_data', detail: 'No DMARC reports in the last 30 days (needs the real sending domain)' };
    const rate = Number(row?.passed ?? 0) / total;
    return { ...base, value: pct(rate, 2), status: rate >= 0.99 ? 'meets' : 'misses', detail: `${Number(row?.passed ?? 0)} of ${total} messages passed DKIM or SPF alignment` };
  }

  private async m7m8(): Promise<Metric[]> {
    const last = await this.deps.db.select({ id: sends.id, name: sends.name }).from(sends).where(eq(sends.status, 'sent')).orderBy(desc(sends.finishedAt)).limit(3);
    const m7 = { id: 'M7', name: 'Hard bounce rate', target: 'Under 2% per send', source: 'Last three sends' };
    const m8 = { id: 'M8', name: 'Spam complaint rate', target: 'Under 0.1% per send', source: 'Last three sends' };
    if (last.length === 0) return [{ ...m7, value: '—', status: 'no_data', detail: 'No finished send yet' }, { ...m8, value: '—', status: 'no_data', detail: 'No finished send yet' }];
    const rows = await this.deps.db
      .select({ sendId: deliveries.sendId, status: deliveries.status, n: sql<number>`count(*)` })
      .from(deliveries)
      .where(inArray(deliveries.sendId, last.map((send) => send.id)))
      .groupBy(deliveries.sendId, deliveries.status);
    const rates = last.map((send) => {
      const by = Object.fromEntries(rows.filter((row) => row.sendId === send.id).map((row) => [row.status, Number(row.n)]));
      const delivered = (by.delivered ?? 0) + (by.sent ?? 0) + (by.bounced_hard ?? 0) + (by.bounced_soft ?? 0) + (by.complained ?? 0);
      return { name: send.name, hard: delivered ? (by.bounced_hard ?? 0) / delivered : 0, complaints: delivered ? (by.complained ?? 0) / delivered : 0 };
    });
    const worstHard = Math.max(...rates.map((rate) => rate.hard));
    const worstComplaints = Math.max(...rates.map((rate) => rate.complaints));
    const detail = (key: 'hard' | 'complaints', digits: number) => rates.map((rate) => `${rate.name}: ${pct(rate[key], digits)}`).join('; ');
    return [
      { ...m7, value: `worst ${pct(worstHard, 2)}`, status: worstHard < 0.02 ? 'meets' : 'misses', detail: detail('hard', 2) },
      { ...m8, value: `worst ${pct(worstComplaints, 3)}`, status: worstComplaints < 0.001 ? 'meets' : 'misses', detail: detail('complaints', 3) },
    ];
  }

  private async m9(): Promise<Metric> {
    const base = { id: 'M9', name: 'Newsletter staff time', target: 'Under 30 minutes', source: 'Last sent issue: first staff edit or comment on the draft to approval (newsletter audit log)' };
    const [issue] = await this.deps.db
      .select({ id: issues.id, edition: issues.edition, approvedAt: sends.approvedAt })
      .from(issues)
      .innerJoin(sends, eq(issues.sendId, sends.id))
      .where(and(eq(issues.status, 'sent'), isNotNull(sends.approvedAt)))
      .orderBy(desc(sends.approvedAt))
      .limit(1);
    if (!issue?.approvedAt) return { ...base, value: '—', status: 'no_data', detail: 'No issue sent yet' };
    const [edit] = await this.deps.db.select({ at: sql<Date>`min(${issueEdits.createdAt})` }).from(issueEdits).where(eq(issueEdits.issueId, issue.id));
    const [comment] = await this.deps.db.select({ at: sql<Date>`min(${issueComments.createdAt})` }).from(issueComments).where(eq(issueComments.issueId, issue.id));
    const starts = [edit?.at, comment?.at].filter(Boolean).map((at) => new Date(at as Date).getTime());
    if (starts.length === 0) return { ...base, value: '0 min', status: 'meets', detail: `${issue.edition}: approved without edits` };
    const minutes = (issue.approvedAt.getTime() - Math.min(...starts)) / 60_000;
    return { ...base, value: `${Math.max(0, Math.round(minutes))} min`, status: minutes < 30 ? 'meets' : 'misses', detail: `${issue.edition}; time between sessions counts too, so read it as an upper bound` };
  }

  private async m10(): Promise<Metric> {
    const now = this.now();
    const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1)).toISOString().slice(0, 7));
    const sent = await this.deps.db
      .select({ month: sql<string>`to_char(${sends.finishedAt} at time zone 'Asia/Yerevan', 'YYYY-MM')` })
      .from(issues)
      .innerJoin(sends, eq(issues.sendId, sends.id))
      .where(and(eq(issues.status, 'sent'), isNotNull(sends.finishedAt)));
    const withIssue = new Set(sent.map((row) => row.month));
    const missed = months.filter((month) => !withIssue.has(month));
    const base = { id: 'M10', name: 'Newsletter cadence', target: 'At least one issue a month, none skipped', source: 'Issues sent in each of the last six full months' };
    if (withIssue.size === 0) return { ...base, value: '—', status: 'no_data', detail: 'No issue sent yet' };
    return { ...base, value: `${months.length - missed.length} of ${months.length} months`, status: missed.length ? 'misses' : 'meets', detail: missed.length ? `No issue in ${missed.join(', ')}` : 'Every month had an issue' };
  }

  private async m11(): Promise<Metric> {
    const thisWeek = isoWeek(this.now());
    const lastWeek = isoWeek(new Date(this.now().getTime() - 7 * DAY));
    const rows = await this.deps.db.select().from(staffActivity).where(inArray(staffActivity.week, [thisWeek, lastWeek]));
    const marketing = (week: string) => rows.filter((row) => row.week === week && ['editor', 'marketing_manager', 'admin'].includes(row.role)).length;
    const base = { id: 'M11', name: 'Weekly active staff users', target: 'All marketing staff, every week', source: 'Marketing staff who opened the Overview (first-party log)' };
    if (rows.length === 0) return { ...base, value: '—', status: 'no_data', detail: 'Nobody has opened the Overview yet' };
    return { ...base, value: `${marketing(thisWeek)} this week`, status: 'no_data', detail: `${marketing(lastWeek)} last week. Compare with the size of the marketing team: the Core Engine staff list is needed to judge "all"` };
  }
}
