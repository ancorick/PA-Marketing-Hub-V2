import { useQuery } from '@tanstack/react-query';
import { getProgramMetrics, type ProgramMetric } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useT, type StringKey } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, DataTable, StatusBadge, type Column, type Tone } from '../../ui';

const STATUS: Record<ProgramMetric['status'], { tone: Tone; label: StringKey }> = {
  meets: { tone: 'success', label: 'lg.m.meets' },
  misses: { tone: 'danger', label: 'lg.m.misses' },
  no_data: { tone: 'neutral', label: 'lg.m.noData' },
};

/** Success metrics M1–M11 (PRD 3.2), measured from live data for the final acceptance (17.1). */
export function MetricsSection() {
  const t = useT();
  const role = useStaffRole();
  const metrics = useQuery({ queryKey: ['program-metrics', role], queryFn: getProgramMetrics });
  const access = accessProblem(metrics.error);
  if (access)
    return (
      <AccessNotice problem={access} title={t('lg.m.signIn')}>
        {t('lg.m.everyRole')}
      </AccessNotice>
    );
  const columns: Column<ProgramMetric>[] = [
    {
      key: 'metric',
      header: t('lg.m.metric'),
      render: (row) => (
        <div className="stack stack--xs cell-wide">
          <span>
            <span className="muted">{row.id}</span> {row.name}
          </span>
          <span className="muted">{row.source}</span>
        </div>
      ),
      sortValue: (row) => Number(row.id.slice(1)),
      csv: (row) => `${row.id} ${row.name}`,
    },
    { key: 'value', header: t('lg.m.now'), render: (row) => <strong className="num">{row.value}</strong>, csv: (row) => row.value },
    { key: 'target', header: t('lg.m.target'), render: (row) => row.target, csv: (row) => row.target },
    {
      key: 'status',
      header: t('lg.m.status'),
      render: (row) => (
        <div className="stack stack--xs">
          <StatusBadge tone={STATUS[row.status].tone}>{t(STATUS[row.status].label)}</StatusBadge>
          <span className="muted">{row.detail}</span>
        </div>
      ),
      sortValue: (row) => row.status,
      csv: (row) => `${row.status}: ${row.detail}`,
    },
  ];
  return (
    <section className="card stack" aria-labelledby="metrics-heading">
      <div className="card__header">
        <h2 id="metrics-heading">{t('lg.m.title')}</h2>
        {metrics.data && <span className="muted num">{t('lg.m.measured', { date: formatDate(metrics.data.checkedAt, undefined, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>}
      </div>
      <p className="muted">{t('lg.m.intro')}</p>
      {metrics.isError && <Alert tone="danger" title={t('lg.m.notLoaded')}>{metrics.error.message}</Alert>}
      <DataTable caption={t('lg.m.title')} captionHidden columns={columns} rows={metrics.data?.metrics ?? []} rowKey={(row) => row.id} loading={metrics.isPending} exportFile="success-metrics" />
    </section>
  );
}
