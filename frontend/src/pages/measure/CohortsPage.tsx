import { useQuery } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { getCohorts, listAnalyticsChannels, type CohortRow } from '../../lib/api';
import { formatAmd } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import {
  AccessNotice,
  accessProblem,
  Alert,
  AttributionFilter,
  ChartCard,
  DataTable,
  downloadCsv,
  FilterBar,
  PageHeader,
  SkeletonCard,
  StatTile,
  StatusBadge,
  tableCsv,
  type Column,
} from '../../ui';
import { CountCell, countCsv, countText, countValue } from '../analytics/numbers';
import { useModel } from '../analytics/period';
import { amd, ChannelFilter, chartCount, chartCountFormat, ExportCsvButton, LineChart, useMonthLabel } from './shared';

const STAGES = ['lead', 'applied', 'enrolled', 'completed', 'hired'] as const;
const sum = (rows: CohortRow[], pick: (row: CohortRow) => number) => rows.reduce((total, row) => total + pick(row), 0);

/**
 * Cohorts (PRD 9.5, 9.6, ANL-09, ANL-10; RESTRUCTURE R3): people grouped by the month of their first touch with
 * everything that happened to them since. Cohorts under 12 months are maturing: their cost per hired graduate is
 * shown only as a provisional "so far" value.
 */
export function CohortsPage() {
  const t = useT();
  const role = useStaffRole();
  const [model, setModel] = useModel();
  const [channel, setChannel] = useState('');
  const cohorts = useQuery({ queryKey: ['cohorts', role, model, channel], queryFn: () => getCohorts(model, channel || undefined) });
  const channels = useQuery({ queryKey: ['analytics-channels', role], queryFn: listAnalyticsChannels, staleTime: Infinity });
  const monthLabel = useMonthLabel();
  // Months before the first recorded touch are left out (newest first, so trim from the end).
  const all = cohorts.data?.cohorts ?? [];
  let lastActive = all.length - 1;
  while (lastActive >= 0 && countValue(all[lastActive]!.people) === 0 && all[lastActive]!.costAmd === 0) lastActive -= 1;
  const rows = all.slice(0, lastActive + 1);
  const shared = cohorts.data?.shared ?? false;
  const format = chartCountFormat(shared);

  const columns: Column<CohortRow>[] = [
    {
      key: 'month',
      header: t('co.firstTouchMonth'),
      render: (row) => (
        <span className="cluster cluster--nowrap">
          <span className="nowrap">{monthLabel(row.month)}</span>
          {row.maturing && <StatusBadge tone="warning">{t('co.maturing')}</StatusBadge>}
        </span>
      ),
      sortValue: (row) => row.month,
      csv: (row) => `${row.month}${row.maturing ? ' (maturing)' : ''}`,
    },
    ...STAGES.map(
      (stage): Column<CohortRow> => ({
        key: stage,
        header: t(`m.${stage === 'lead' ? 'leads' : stage}` as 'm.leads'),
        numeric: true,
        definition: t('co.stageDefinition'),
        render: (row) => <CountCell value={row[stage]} label={stage} />,
        csv: (row) => countCsv(row[stage]),
        sortValue: (row) => countValue(row[stage]),
      }),
    ),
    { key: 'cost', header: t('m.spend'), numeric: true, definition: t('co.spendDefinition'), render: (row) => formatAmd(row.costAmd), sortValue: (row) => row.costAmd },
    {
      key: 'perEnrolled',
      header: t('m.costPerEnrolled'),
      numeric: true,
      render: (row) => <span className={row.costPerEnrolled === null ? 'muted' : undefined}>{amd(row.costPerEnrolled)}</span>,
      sortValue: (row) => row.costPerEnrolled ?? -1,
      csv: (row) => row.costPerEnrolled,
    },
    {
      key: 'perHired',
      header: t('m.costPerHired'),
      numeric: true,
      definition: t('co.perHiredDefinition'),
      render: (row) =>
        row.maturing ? (
          row.costPerHiredSoFar === null ? (
            <span className="muted">—</span>
          ) : (
            <span className="muted">
              {formatAmd(row.costPerHiredSoFar)} {t('co.soFar')}
            </span>
          )
        ) : (
          <span className={row.costPerHired === null ? 'muted' : undefined}>{amd(row.costPerHired)}</span>
        ),
      sortValue: (row) => row.costPerHired ?? row.costPerHiredSoFar ?? -1,
      csv: (row) => (row.maturing ? (row.costPerHiredSoFar === null ? 'maturing' : `${row.costPerHiredSoFar} (so far)`) : row.costPerHired),
    },
  ];

  const access = accessProblem(cohorts.error);
  const exportFile = `cohorts-${model}${channel ? `-${channel}` : ''}`;
  const mature = rows.filter((row) => !row.maturing);
  const matureHired = sum(mature, (row) => countValue(row.hired));
  const matureCost = sum(mature, (row) => row.costAmd);
  const chronological = [...rows].reverse().map((row) => ({ month: row.month, label: monthLabel(row.month), lead: chartCount(row.lead), enrolled: chartCount(row.enrolled), hired: chartCount(row.hired) }));
  const best = chronological.reduce<(typeof chronological)[number] | null>((top, row) => (!top || row.lead > top.lead ? row : top), null);
  const totals = Object.fromEntries(STAGES.map((stage) => [stage, sum(rows, (row) => countValue(row[stage]))])) as Record<(typeof STAGES)[number], number>;
  const modelLabel = cohorts.data?.modelLabel ?? '';
  // Sums over hidden small counts would be guesses: views shared outside marketing show no totals.
  const total = (value: number) => (!cohorts.data || shared ? '—' : countText(value));

  return (
    <>
      <PageHeader
        title={t('nav.cohorts')}
        description={t('co.description')}
        actions={<ExportCsvButton disabled={rows.length === 0} onExport={() => downloadCsv(exportFile, tableCsv(columns, rows))} />}
      />
      <FilterBar label={t('m.filters')}>
        <AttributionFilter value={model} onChange={setModel} />
        <ChannelFilter value={channel} onChange={setChannel} channels={channels.data?.channels ?? []} />
      </FilterBar>
      {access ? (
        <AccessNotice problem={access} title="Sign in to see cohorts">
          Every staff role sees cohorts.
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          {cohorts.isError && <Alert tone="danger" title={t('m.notLoaded')}>{cohorts.error.message}</Alert>}
          <div className="grid-12">
            <div className="span-3">
              <StatTile tone="yellow" label={t('m.leads')} value={total(totals.lead)} caption={t('co.lastMonths', { n: rows.length })} definition={t('co.stageDefinition')} />
            </div>
            <div className="span-3">
              <StatTile
                label={t('m.enrolled')}
                value={total(totals.enrolled)}
                caption={!shared && totals.lead > 0 ? t('co.ofLeads', { pct: `${Math.round((totals.enrolled / totals.lead) * 1000) / 10}%` }) : undefined}
                definition={t('co.stageDefinition')}
              />
            </div>
            <div className="span-3">
              <StatTile label={t('m.hired')} value={total(totals.hired)} caption={t('co.hiredCaption')} definition={t('co.stageDefinition')} />
            </div>
            <div className="span-3">
              <StatTile
                label={t('co.perHiredMature')}
                value={!shared && matureHired > 0 ? formatAmd(Math.round(matureCost / matureHired)) : '—'}
                caption={t('co.matureCohorts', { n: mature.length })}
                definition={t('co.perHiredDefinition')}
              />
            </div>
          </div>

          <Suspense fallback={<SkeletonCard />}>
            <ChartCard
              title={t('co.chart')}
              description={modelLabel ? t('ov.creditedBy', { model: modelLabel }) : undefined}
              definition={t('co.chartDefinition')}
              summary={best && best.lead > 0 ? t('co.chartSummary', { month: best.label, n: format(best.lead) }) : t('chart.noData')}
              loading={cohorts.isPending}
              empty={!cohorts.isPending && chronological.every((row) => row.lead === 0)}
              table={{
                columns: [
                  { key: 'label', header: t('co.firstTouchMonth') },
                  { key: 'lead', header: t('m.leads'), numeric: true, render: (row) => format(row.lead) },
                  { key: 'enrolled', header: t('m.enrolled'), numeric: true, render: (row) => format(row.enrolled) },
                  { key: 'hired', header: t('m.hired'), numeric: true, render: (row) => format(row.hired) },
                ],
                rows: chronological,
                rowKey: (row) => row.month,
              }}
            >
              <LineChart
                data={chronological}
                xKey="label"
                format={format}
                series={[
                  { key: 'lead', label: t('m.leads') },
                  { key: 'enrolled', label: t('m.enrolled') },
                  { key: 'hired', label: t('m.hired') },
                ]}
                label={t('co.chart')}
              />
            </ChartCard>
          </Suspense>

          <section className="card stack" aria-labelledby="cohort-table-heading">
            <div className="card__header">
              <div>
                <h2 id="cohort-table-heading">{t('co.table')}</h2>
                <p className="muted">{t('co.tableHint')}</p>
              </div>
              {modelLabel && <StatusBadge tone="neutral">{modelLabel}</StatusBadge>}
            </div>
            <DataTable
              caption={t('co.table')}
              captionHidden
              columns={columns}
              rows={rows}
              rowKey={(row) => row.month}
              loading={cohorts.isPending}
              dense
              totals={{
                month: t('table.total'),
                ...Object.fromEntries(STAGES.map((stage) => [stage, total(totals[stage])])),
                cost: formatAmd(sum(rows, (row) => row.costAmd)),
              }}
            />
            {shared && <p className="note">{t('m.smallNumbers')}</p>}
          </section>
        </div>
      )}
    </>
  );
}
