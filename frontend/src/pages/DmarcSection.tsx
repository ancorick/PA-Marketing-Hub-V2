import { ShieldWarning } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dmarcSummary, uploadDmarcReport, type DmarcSource } from '../lib/api';
import { formatDate, formatNumber, formatPercent } from '../lib/format';
import { useT, type StringKey } from '../lib/i18n';
import { useStaffRole } from '../lib/session';
import { Alert, DataTable, StatTile, StatusBadge, type Column, type Tone } from '../ui';

const CATEGORY: Record<DmarcSource['category'], { tone: Tone; label: StringKey }> = {
  pass: { tone: 'success', label: 'lg.d.pass' },
  fail: { tone: 'warning', label: 'lg.d.fail' },
  unknown: { tone: 'danger', label: 'lg.d.unknown' },
};

function sourceColumns(t: ReturnType<typeof useT>): Column<DmarcSource>[] {
  return [
    { key: 'ip', header: t('lg.d.sourceIp'), render: (s) => <code>{s.sourceIp}</code> },
    { key: 'category', header: t('lg.d.result'), render: (s) => <StatusBadge tone={CATEGORY[s.category].tone}>{t(CATEGORY[s.category].label)}</StatusBadge> },
    { key: 'domain', header: t('lg.d.domain'), render: (s) => s.domain },
    { key: 'messages', header: t('lg.d.messages'), numeric: true, render: (s) => <span className="num">{formatNumber(s.messages)}</span>, sortValue: (s) => s.messages },
    { key: 'reporters', header: t('lg.d.reportedBy'), render: (s) => s.reporters.join(', ') },
    { key: 'seen', header: t('lg.d.lastSeen'), render: (s) => <span className="num nowrap">{formatDate(s.lastSeen)}</span> },
  ];
}

/** EML-07: who sends as the Academy's domain, and whether it passes DMARC (metric M6). */
export function DmarcSection() {
  const t = useT();
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
        <h2 id="dmarc-heading">{t('lg.d.title')}</h2>
      </div>
      <p className="muted">{t('lg.d.intro')}</p>
      {role === 'admin' && (
        <div className="field">
          <label className="field__label" htmlFor="dmarc-file">
            {t('lg.d.upload')}
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
          <Alert tone={upload.data.unknownSources.length > 0 ? 'warning' : 'success'} title={upload.data.duplicate ? t('lg.d.duplicate') : t('lg.d.read', { n: upload.data.records })}>
            {upload.data.unknownSources.length > 0 ? t('lg.d.unknownFailing', { list: upload.data.unknownSources.join(', ') }) : undefined}
          </Alert>
        )}
        {upload.isError && <Alert tone="danger" title={t('lg.d.notRead')}>{upload.error.message}</Alert>}
      </div>
      {data && data.reports > 0 ? (
        <>
          <div className="tiles">
            <StatTile label={t('lg.d.passRate')} value={data.passRate === null ? null : formatPercent(data.passRate)} definition={t('lg.d.passRateDefinition')} />
            <StatTile label={t('lg.d.reported')} value={formatNumber(data.messages)} definition={t('lg.d.reportedDefinition')} />
            <StatTile label={t('lg.d.unknownSources')} value={formatNumber(data.sources.filter((s) => s.category === 'unknown').length)} definition={t('lg.d.unknownDefinition')} />
            <StatTile label={t('lg.d.reports')} value={formatNumber(data.reports)} definition={t('lg.d.reportsDefinition')} />
          </div>
          <DataTable caption={t('lg.d.sourcesCaption')} columns={sourceColumns(t)} rows={data.sources} rowKey={(s) => `${s.sourceIp}:${s.category}:${s.domain}`} initialSort={{ key: 'messages', direction: 'descending' }} />
        </>
      ) : (
        <p className="muted">{summary.isPending ? t('lg.d.loading') : t('lg.d.none')}</p>
      )}
    </section>
  );
}
