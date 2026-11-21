import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getCohorts, listAnalyticsChannels, type CohortRow } from '../../lib/api';
import { formatAmd } from '../../lib/format';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, DataTable, SelectField, StatusBadge, type Column } from '../../ui';
import { CountCell, countValue } from './numbers';
import { ModelSwitch, useModel } from './period';

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const money = (value: number | null) => (value === null ? <span className="muted">—</span> : formatAmd(value));

/** Cohorts (PRD 9.5, 9.6, ANL-09, ANL-10): outcomes by month of first touch; maturing cohorts labelled. */
export function CohortsSection() {
  const role = useStaffRole();
  const [model, setModel] = useModel();
  const [channel, setChannel] = useState('');
  const cohorts = useQuery({ queryKey: ['cohorts', role, model, channel], queryFn: () => getCohorts(model, channel || undefined) });
  const channels = useQuery({ queryKey: ['analytics-channels', role], queryFn: listAnalyticsChannels, staleTime: Infinity });
  const access = accessProblem(cohorts.error);
  if (access)
    return (
      <AccessNotice problem={access} title="Sign in to see cohorts">
        Every staff role sees cohorts.
      </AccessNotice>
    );
  const columns: Column<CohortRow>[] = [
    {
      key: 'month',
      header: 'First touch in',
      render: (row) => (
        <span className="cluster cluster--nowrap">
          <span className="nowrap">{monthLabel(row.month)}</span>
          {row.maturing && <StatusBadge tone="info">Maturing</StatusBadge>}
        </span>
      ),
      sortValue: (row) => row.month,
    },
    { key: 'people', header: 'People', numeric: true, render: (row) => <CountCell value={row.people} label="people" />, sortValue: (row) => countValue(row.people) },
    ...(['lead', 'enrolled', 'hired'] as const).map(
      (stage): Column<CohortRow> => ({
        key: stage,
        header: { lead: 'Leads', enrolled: 'Enrolled', hired: 'Hired' }[stage],
        numeric: true,
        definition: `People of the cohort who became ${stage === 'lead' ? 'leads' : stage} at any time since.`,
        render: (row) => <CountCell value={row[stage]} label={stage} />,
        sortValue: (row) => countValue(row[stage]),
      }),
    ),
    { key: 'cost', header: 'Cost',
      definition: 'Channel cost in the cohort month, in AMD.', numeric: true, render: (row) => formatAmd(row.costAmd), sortValue: (row) => row.costAmd },
    { key: 'perEnrolled', header: 'Cost per enrolled', numeric: true, render: (row) => money(row.costPerEnrolled), sortValue: (row) => row.costPerEnrolled ?? -1 },
    {
      key: 'perHired',
      header: 'Cost per hired',
      numeric: true,
      definition: 'Cost of the cohort month divided by its hired graduates. Shown only for cohorts at least 12 months old; younger cohorts are still maturing.',
      render: (row) => (row.maturing ? <span className="muted">Maturing</span> : money(row.costPerHired)),
      sortValue: (row) => row.costPerHired ?? -1,
    },
  ];
  return (
    <div className="stack stack--lg">
      <div className="cluster cluster--md">
        <ModelSwitch model={model} onChange={setModel} />
      </div>
      <section className="card stack" aria-labelledby="cohorts-heading">
        <div className="card__header">
          <h2 id="cohorts-heading">Cohorts</h2>
          {cohorts.data && <StatusBadge tone="neutral">{cohorts.data.modelLabel}</StatusBadge>}
        </div>
        <p className="muted">
          People grouped by the month of their first touch, with everything that happened to them since, so cost and outcomes belong to the same people. Hiring lags by a year or
          more: cohorts younger than 12 months are maturing and show no cost per hired graduate.
        </p>
        <div className="field-narrow">
          <SelectField
            label="Channel"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            options={[{ value: '', label: 'All channels' }, ...(channels.data?.channels ?? []).map((item) => ({ value: item.id, label: item.name }))]}
            hint={channel ? 'People credited to this channel by the chosen model.' : undefined}
          />
        </div>
        {cohorts.isError && <Alert tone="danger" title="Cohorts not loaded">{cohorts.error.message}</Alert>}
        <DataTable caption="Cohorts by month of first touch" captionHidden columns={columns} rows={cohorts.data?.cohorts ?? []} rowKey={(row) => row.month} loading={cohorts.isPending} />
      </section>
    </div>
  );
}
