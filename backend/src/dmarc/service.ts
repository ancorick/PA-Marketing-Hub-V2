import { gunzipSync } from 'node:zlib';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { XMLParser } from 'fast-xml-parser';
import type { AlertService } from '../alerts/service.js';
import type { AppPgDatabase } from '../db/client.js';
import { dmarcRecords, dmarcReports } from '../db/schema.js';

export class DmarcReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DmarcReportError';
  }
}

export type DmarcCategory = 'pass' | 'fail' | 'unknown';

type ParsedRecord = { sourceIp: string; count: number; disposition: string | null; dkim: string | null; spf: string | null; headerFrom: string | null };

export type ParsedReport = {
  orgName: string;
  reportId: string;
  domain: string;
  policy: string | null;
  dateBegin: Date;
  dateEnd: Date;
  records: ParsedRecord[];
};

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  // Reports with a single <record> still give an array.
  isArray: (name) => name === 'record',
  // No entity expansion: reports come from outside (XXE / billion-laughs safety).
  processEntities: false,
});

const text = (value: unknown): string | null => (value === undefined || value === null || value === '' ? null : String(value).trim());

/** Reads a DMARC aggregate report (RFC 7489 appendix C), plain XML or gzip. */
export function parseDmarcReport(input: Buffer): ParsedReport {
  let xml: string;
  try {
    xml = (input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input, { maxOutputLength: 50 * 1024 * 1024 }) : input).toString('utf8');
  } catch {
    throw new DmarcReportError('The file is not valid gzip; upload the .xml or .xml.gz from the report email (unzip .zip files first)');
  }
  if (input[0] === 0x50 && input[1] === 0x4b) throw new DmarcReportError('Zip files are not supported yet; unzip it and upload the .xml inside');
  let feedback: Record<string, unknown>;
  try {
    feedback = (parser.parse(xml) as { feedback?: Record<string, unknown> }).feedback ?? {};
  } catch {
    throw new DmarcReportError('The file is not readable XML');
  }
  const metadata = (feedback.report_metadata ?? {}) as Record<string, unknown>;
  const range = (metadata.date_range ?? {}) as Record<string, unknown>;
  const published = (feedback.policy_published ?? {}) as Record<string, unknown>;
  const orgName = text(metadata.org_name);
  const reportId = text(metadata.report_id);
  const domain = text(published.domain)?.toLowerCase();
  const begin = Number(range.begin);
  const end = Number(range.end);
  if (!orgName || !reportId || !domain || !Number.isFinite(begin) || !Number.isFinite(end)) {
    throw new DmarcReportError('This is not a DMARC aggregate report (report_metadata or policy_published is missing)');
  }
  const records = ((feedback.record as Record<string, unknown>[] | undefined) ?? []).map((record) => {
    const row = (record.row ?? {}) as Record<string, unknown>;
    const evaluated = (row.policy_evaluated ?? {}) as Record<string, unknown>;
    const identifiers = (record.identifiers ?? {}) as Record<string, unknown>;
    return {
      sourceIp: text(row.source_ip) ?? 'unknown',
      count: Math.max(0, Number(row.count) || 0),
      disposition: text(evaluated.disposition),
      dkim: text(evaluated.dkim),
      spf: text(evaluated.spf),
      headerFrom: text(identifiers.header_from)?.toLowerCase() ?? null,
    };
  });
  return { orgName, reportId, domain, policy: text(published.p), dateBegin: new Date(begin * 1000), dateEnd: new Date(end * 1000), records };
}

const ipv4ToInt = (ip: string) => ip.split('.').reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;

/** True when the IP equals an entry or falls in an IPv4 CIDR range of the known-senders list. */
export function inKnownSources(ip: string, known: string[]): boolean {
  return known.some((entry) => {
    if (!entry.includes('/')) return entry === ip;
    const [base, bits] = entry.split('/') as [string, string];
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
  });
}

/** DMARC passes when DKIM or SPF passes with alignment (policy_evaluated). */
export function categorize(record: Pick<ParsedRecord, 'dkim' | 'spf' | 'sourceIp'>, known: string[]): DmarcCategory {
  if (record.dkim === 'pass' || record.spf === 'pass') return 'pass';
  return inKnownSources(record.sourceIp, known) ? 'fail' : 'unknown';
}

type Deps = { db: AppPgDatabase; alerts: AlertService; knownSources: string[] };

/**
 * DMARC aggregate reports (EML-07, PRD 7.2): pass, fail and unknown sources, and the alignment pass rate
 * behind metric M6. A failing unknown source raises an admin alert (7.4). Reports are uploaded on the
 * Email settings screen until the rua mailbox is connected to an inbox reader.
 */
export class DmarcService {
  constructor(private readonly deps: Deps) {}

  async ingest(input: Buffer, actorId: string): Promise<{ reportId: string; duplicate: boolean; records: number; unknownSources: string[] }> {
    const report = parseDmarcReport(input);
    const [existing] = await this.deps.db
      .select({ id: dmarcReports.id })
      .from(dmarcReports)
      .where(and(eq(dmarcReports.orgName, report.orgName), eq(dmarcReports.reportId, report.reportId)));
    if (existing) return { reportId: existing.id, duplicate: true, records: report.records.length, unknownSources: [] };

    const rows = report.records.map((record) => ({ ...record, category: categorize(record, this.deps.knownSources) }));
    const id = await this.deps.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(dmarcReports)
        .values({ orgName: report.orgName, reportId: report.reportId, domain: report.domain, policy: report.policy, dateBegin: report.dateBegin, dateEnd: report.dateEnd, uploadedBy: actorId })
        .returning({ id: dmarcReports.id });
      const reportUuid = (created as { id: string }).id;
      if (rows.length > 0) await tx.insert(dmarcRecords).values(rows.map((row) => ({ ...row, reportId: reportUuid })));
      return reportUuid;
    });

    const unknown = [...new Set(rows.filter((row) => row.category === 'unknown' && row.count > 0).map((row) => row.sourceIp))];
    if (unknown.length > 0) {
      await this.deps.alerts.raise({
        level: 'warning',
        roles: ['admin'],
        title: `DMARC failures from ${unknown.length === 1 ? 'an unknown source' : `${unknown.length} unknown sources`}`,
        message: `${report.orgName} saw mail for ${report.domain} from ${unknown.slice(0, 5).join(', ')} failing SPF and DKIM. If it is a service you use, add its IPs to DMARC_KNOWN_SOURCES; otherwise someone may be spoofing the domain.`,
        link: '#/email-settings',
        dedupeKey: `dmarc-unknown:${report.domain}:${unknown.sort().join(',')}`,
      });
    }
    return { reportId: id, duplicate: false, records: rows.length, unknownSources: unknown };
  }

  /** Sources and the alignment pass rate (M6) over the last `days` days. */
  async summary(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const sources = await this.deps.db
      .select({
        sourceIp: dmarcRecords.sourceIp,
        category: dmarcRecords.category,
        domain: dmarcReports.domain,
        messages: sql<number>`sum(${dmarcRecords.count})`,
        lastSeen: sql<Date>`max(${dmarcReports.dateEnd})`,
        reporters: sql<string[]>`array_agg(distinct ${dmarcReports.orgName})`,
      })
      .from(dmarcRecords)
      .innerJoin(dmarcReports, eq(dmarcReports.id, dmarcRecords.reportId))
      .where(gte(dmarcReports.dateEnd, since))
      .groupBy(dmarcRecords.sourceIp, dmarcRecords.category, dmarcReports.domain)
      .orderBy(desc(sql`sum(${dmarcRecords.count})`));
    const totals: Record<DmarcCategory, number> = { pass: 0, fail: 0, unknown: 0 };
    for (const source of sources) totals[source.category as DmarcCategory] += Number(source.messages);
    const messages = totals.pass + totals.fail + totals.unknown;
    const reports = await this.deps.db.select({ value: sql<number>`count(*)` }).from(dmarcReports).where(gte(dmarcReports.dateEnd, since));
    return {
      days,
      reports: Number(reports[0]?.value ?? 0),
      messages,
      totals,
      /** M6: share of messages passing DMARC alignment; null without reports. */
      passRate: messages > 0 ? totals.pass / messages : null,
      sources: sources.map((source) => ({
        sourceIp: source.sourceIp,
        domain: source.domain,
        category: source.category as DmarcCategory,
        messages: Number(source.messages),
        lastSeen: new Date(source.lastSeen).toISOString(),
        reporters: source.reporters,
      })),
    };
  }
}
