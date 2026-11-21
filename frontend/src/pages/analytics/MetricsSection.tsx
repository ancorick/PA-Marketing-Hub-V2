import { useQuery } from '@tanstack/react-query';
import { getProgramMetrics, type ProgramMetric } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, DataTable, StatusBadge, type Column, type Tone } from '../../ui';

const STATUS: Record<ProgramMetric['status'], { tone: Tone; label: string }> = {
  meets: { tone: 'success', label: 'Meets target' },
  misses: { tone: 'danger', label: 'Misses target' },
  no_data: { tone: 'neutral', label: 'No data yet' },
};

/** Success metrics M1–M11 (PRD 3.2), measured from live data for the final acceptance (17.1). */
export function MetricsSection() {
  const role = useStaffRole();
  const metrics = useQuery({ queryKey: ['program-metrics', role], queryFn: getProgramMetrics });
  const access = accessProblem(metrics.error);
  if (access)
    return (
      <AccessNotice problem={access} title="Sign in to see the success metrics">
        Every staff role sees the success metrics.
      </AccessNotice>
    );
  const columns: Column<ProgramMetric>[] = [
    {
      key: 'metric',
      header: 'Metric',
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
    { key: 'value', header: 'Now', render: (row) => <strong className="num">{row.value}</strong>, csv: (row) => row.value },
    { key: 'target', header: 'Target', render: (row) => row.target, csv: (row) => row.target },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="stack stack--xs">
          <StatusBadge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</StatusBadge>
          <span className="muted">{row.detail}</span>
        </div>
      ),
      sortValue: (row) => row.status,
      csv: (row) => `${STATUS[row.status].label}: ${row.detail}`,
    },
  ];
  return (
    <section className="card stack" aria-labelledby="metrics-heading">
      <div className="card__header">
        <h2 id="metrics-heading">Success metrics</h2>
        {metrics.data && <span className="muted num">Measured {formatDate(metrics.data.checkedAt, undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
      </div>
      <p className="muted">The measures of PRD 3.2, from Marketing Hub's own data. They decide the final acceptance; “no data yet” means there is nothing to measure until real sends, issues or sources run.</p>
      {metrics.isError && <Alert tone="danger" title="Metrics not loaded">{metrics.error.message}</Alert>}
      <DataTable caption="Success metrics" captionHidden columns={columns} rows={metrics.data?.metrics ?? []} rowKey={(row) => row.id} loading={metrics.isPending} exportFile="success-metrics" />
    </section>
  );
}
