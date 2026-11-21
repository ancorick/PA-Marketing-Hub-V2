import { ShieldWarning } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dmarcSummary, uploadDmarcReport, type DmarcSource } from '../lib/api';
import { formatDate, formatNumber, formatPercent } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { Alert, DataTable, StatTile, StatusBadge, type Column, type Tone } from '../ui';

const CATEGORY: Record<DmarcSource['category'], { tone: Tone; label: string }> = {
  pass: { tone: 'success', label: 'Pass' },
  fail: { tone: 'warning', label: 'Fail (known sender)' },
  unknown: { tone: 'danger', label: 'Unknown source' },
};

const columns: Column<DmarcSource>[] = [
  { key: 'ip', header: 'Source IP', render: (s) => <code>{s.sourceIp}</code> },
  { key: 'category', header: 'Result', render: (s) => <StatusBadge tone={CATEGORY[s.category].tone}>{CATEGORY[s.category].label}</StatusBadge> },
  { key: 'domain', header: 'Domain', render: (s) => s.domain },
  { key: 'messages', header: 'Messages', numeric: true, render: (s) => <span className="num">{formatNumber(s.messages)}</span>, sortValue: (s) => s.messages },
  { key: 'reporters', header: 'Reported by', render: (s) => s.reporters.join(', ') },
  { key: 'seen', header: 'Last seen', render: (s) => <span className="num">{formatDate(s.lastSeen)}</span> },
];

/** EML-07: who sends as the Academy's domain, and whether it passes DMARC (metric M6). */
export function DmarcSection() {
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: ['dmarc', role], queryFn: () => dmarcSummary(30) });
  const upload = useMutation({ mutationFn: uploadDmarcReport, onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['dmarc'] }) });
  const data = summary.data;

  return (
    <section className="card stack" aria-labelledby="dmarc-heading">
      <div className="cluster">
        <span className="icon-tile icon-tile--sm icon-tile--brand">
          <ShieldWarning size={20} weight="bold" aria-hidden />
        </span>
        <h2 id="dmarc-heading">DMARC reports</h2>
      </div>
      <p className="muted">
        Receivers send daily reports to the rua address in the DMARC record. Upload them here (.xml or .xml.gz) until that mailbox is
        read automatically. Raise the policy to quarantine after two clean weeks (PRD 7.2).
      </p>
      {role === 'admin' && (
        <div className="field">
          <label className="field__label" htmlFor="dmarc-file">
            Upload a report
          </label>
          <input
            id="dmarc-file"
            className="input"
            type="file"
            accept=".xml,.gz,application/xml,application/gzip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.target.value = '';
            }}
          />
        </div>
      )}
      <div role="status" aria-live="polite">
        {upload.data && (
          <Alert tone={upload.data.unknownSources.length > 0 ? 'warning' : 'success'} title={upload.data.duplicate ? 'This report was already uploaded' : `Report read: ${upload.data.records} sources`}>
            {upload.data.unknownSources.length > 0 ? `Unknown sources failing DMARC: ${upload.data.unknownSources.join(', ')}. The admin is alerted.` : undefined}
          </Alert>
        )}
        {upload.isError && <Alert tone="danger" title="Report not read">{upload.error.message}</Alert>}
      </div>
      {data && data.reports > 0 ? (
        <>
          <div className="tiles">
            <StatTile label="Alignment pass rate" value={data.passRate === null ? null : formatPercent(data.passRate)} definition="Share of messages for the domain that passed DMARC (aligned SPF or DKIM) in the last 30 days. Metric M6." />
            <StatTile label="Messages reported" value={formatNumber(data.messages)} definition="Messages using the domain in the From header, as counted by receivers' reports." />
            <StatTile label="Unknown sources" value={formatNumber(data.sources.filter((s) => s.category === 'unknown').length)} definition="IP addresses failing DMARC that are not in DMARC_KNOWN_SOURCES: a forgotten service or spoofing." />
            <StatTile label="Reports" value={formatNumber(data.reports)} definition="Aggregate reports received in the last 30 days." />
          </div>
          <DataTable caption="Sending sources, last 30 days" columns={columns} rows={data.sources} rowKey={(s) => `${s.sourceIp}:${s.category}:${s.domain}`} initialSort={{ key: 'messages', direction: 'descending' }} />
        </>
      ) : (
        <p className="muted">{summary.isPending ? 'Loading…' : 'No reports in the last 30 days.'}</p>
      )}
    </section>
  );
}
