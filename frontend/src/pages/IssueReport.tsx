import { useQuery } from '@tanstack/react-query';
import { issueReport, type IssueReport as Report } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { Alert, DataTable, StatTile, type Column } from '../ui';

const columns: Column<Report['blocks'][number]>[] = [
  { key: 'title', header: 'Block', render: (block) => block.title },
  { key: 'clicks', header: 'Unique clicks', numeric: true, render: (block) => <span className="num">{formatNumber(block.uniqueClicks)}</span>, sortValue: (block) => block.uniqueClicks },
  { key: 'applications', header: 'Applications', numeric: true, render: (block) => <span className="num">{formatNumber(block.applications)}</span>, sortValue: (block) => block.applications },
  { key: 'registrations', header: 'Event registrations', numeric: true, render: (block) => <span className="num">{formatNumber(block.registrations)}</span>, sortValue: (block) => block.registrations },
];

/** NWS-13: what the issue did, overall and per block. */
export function IssueReport({ issueId, archiveSlug }: { issueId: string; archiveSlug: string | null }) {
  const report = useQuery({ queryKey: ['issue-report', issueId], queryFn: () => issueReport(issueId) });
  if (report.isError) return <Alert tone="danger" title="Report not available">{report.error.message}</Alert>;
  const data = report.data;
  if (!data) return null;
  return (
    <section className="card stack" aria-labelledby="report-heading">
      <h2 id="report-heading">Issue report</h2>
      {!data.final && data.finalAt && <Alert tone="info" title={`Preliminary until ${formatDate(data.finalAt)}`}>The report settles seven days after sending; applications keep arriving.</Alert>}
      {archiveSlug && (
        <p>
          Public archive: <a href={`#/p/archive/${archiveSlug}`}>{archiveSlug}</a>
        </p>
      )}
      <div className="tiles">
        <StatTile label="Delivered" value={formatNumber(data.delivered)} definition="Messages the email service accepted or confirmed delivered." />
        <StatTile label="Unique clicks" value={formatNumber(data.uniqueClicks)} definition="People who clicked at least one link." />
        <StatTile label="Applications" value={formatNumber(data.applications)} definition="People who clicked this issue and then applied within 90 days (Navigator CRM)." />
        <StatTile label="Event registrations" value={formatNumber(data.registrations)} definition="People who clicked this issue and then registered for an event within 90 days." />
      </div>
      <p className="muted num">
        Opened (estimated) {formatNumber(data.openedEstimated)} · unsubscribed {formatNumber(data.unsubscribes)} · complaints {formatNumber(data.complaints)} · bounced{' '}
        {formatNumber(data.bounced)}
      </p>
      <DataTable caption="Clicks per block" columns={columns} rows={data.blocks} rowKey={(block) => block.id} initialSort={{ key: 'clicks', direction: 'descending' }} />
    </section>
  );
}
