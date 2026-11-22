import { ArrowClockwise, Info } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { getHealth, getOverview, getSelfReported, listAlerts, listAnalyticsChannels, type Count, type Overview, type OverviewRow, type ViewMode } from '../lib/api';
import { formatAmd, formatNumber, formatPercent } from '../lib/format';
import { useT } from '../lib/i18n';
import { useStaffRole } from '../lib/session';
import {
  AccessNotice,
  accessProblem,
  Alert,
  AttributionFilter,
  Button,
  ChartCard,
  DataTable,
  downloadCsv,
  FilterBar,
  PageHeader,
  PeriodFilter,
  SkeletonCard,
  SkeletonTile,
  StatTile,
  StatusBadge,
  tableCsv,
  ViewToggle,
  type Column,
  type Tone,
} from '../ui';
import { CountCell, countCsv, countText, countValue, peoplePath } from './analytics/numbers';
import { useModel, usePeriod } from './analytics/period';
import { SelfReportedCard } from './analytics/SelfReportedCard';
import { amd, BarChart, channelName, chartCount, chartCountFormat, ExportCsvButton, FunnelChart, LineChart, numberOf, PrintButton, useBucketLabel } from './measure/shared';

function tone(value: string): Tone {
  if (value === 'ok') return 'success';
  if (value === 'embedded' || value === 'mock' || value === 'log') return 'warning';
  return 'danger';
}

const MARKETING = ['editor', 'marketing_manager', 'admin'];
const delta = (value: Count, previous: Count) =>
  typeof value === 'number' && typeof previous === 'number' && previous > 0 ? (value - previous) / previous : undefined;
const tileValue = (value: Count) => (value === 'fewer_than_3' ? null : countText(value));
const SPECIAL = new Set(['unmapped', 'unattributed']);

/**
 * Overview (PRD 9.6, ANL-08; RESTRUCTURE R3): which channel brings students who enroll, finish and get hired,
 * and what each costs, for any period under one named attribution model.
 */
export function HomePage() {
  const t = useT();
  const role = useStaffRole();
  const marketing = MARKETING.includes(role);
  const [period, setPeriod] = usePeriod();
  const [model, setModel] = useModel();
  const [view, setView] = useState<ViewMode>('period');
  const overview = useQuery({ queryKey: ['overview', role, period, model, view], queryFn: () => getOverview(period, model, view) });
  const channels = useQuery({ queryKey: ['analytics-channels', role], queryFn: listAnalyticsChannels, staleTime: Infinity });
  const selfReported = useQuery({ queryKey: ['self-reported', role, period], queryFn: () => getSelfReported(period) });
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth, retry: 1, enabled: role === 'admin' });
  const bucketLabel = useBucketLabel();
  const data = overview.data;
  const definitions = data?.definitions ?? {};
  const modelNote = data ? ` ${t('m.attributionNote', { model: data.modelLabel })}` : '';
  const name = (id: string) => channelName(id, channels.data?.channels);

  const people = (stage: 'lead' | 'enrolled' | 'hired', row: OverviewRow) => (marketing ? peoplePath(stage, row.channel) : null);
  const columns: Column<OverviewRow>[] = [
    {
      key: 'channel',
      header: t('m.channel'),
      render: (row) => (SPECIAL.has(row.channel) ? <span className="muted nowrap">{name(row.channel)}</span> : <a className="nowrap" href={`#/channels/${row.channel}`}>{name(row.channel)}</a>),
      sortValue: (row) => name(row.channel),
    },
    ...(['lead', 'enrolled', 'hired'] as const).map(
      (stage): Column<OverviewRow> => ({
        key: stage,
        header: t(stage === 'lead' ? 'm.leads' : stage === 'enrolled' ? 'm.enrolled' : 'm.hired'),
        numeric: true,
        definition: `${definitions[stage] ?? ''}${modelNote}`,
        render: (row) => <CountCell value={row[stage]} href={people(stage, row)} label={stage} />,
        csv: (row) => countCsv(row[stage]),
        sortValue: (row) => countValue(row[stage]),
      }),
    ),
    {
      key: 'cost',
      header: t('m.spend'),
      numeric: true,
      definition: definitions.channelCost,
      render: (row) => (row.costAmd === 0 ? <span className="muted">{t('ov.noSpend')}</span> : formatAmd(row.costAmd)),
      sortValue: (row) => row.costAmd,
    },
    {
      key: 'perLead',
      header: t('m.costPerLead'),
      numeric: true,
      definition: `${definitions.costPerLead ?? ''}${modelNote}`,
      render: (row) => <span className={row.costPerLead === null || row.costAmd === 0 ? 'muted' : undefined}>{row.costAmd === 0 ? '—' : amd(row.costPerLead)}</span>,
      sortValue: (row) => row.costPerLead ?? -1,
      csv: (row) => row.costPerLead,
    },
    {
      key: 'perEnrolled',
      header: t('m.costPerEnrolledStudent'),
      numeric: true,
      definition: `${definitions.costPerEnrolled ?? ''}${modelNote}`,
      render: (row) =>
        row.costPerEnrolled === null || row.costAmd === 0 ? <span className="muted">{row.costAmd === 0 ? t('ov.noAdSpend') : '—'}</span> : <strong>{formatAmd(row.costPerEnrolled)}</strong>,
      sortValue: (row) => row.costPerEnrolled ?? -1,
      csv: (row) => row.costPerEnrolled,
      bar: (row) => (row.costAmd === 0 ? null : row.costPerEnrolled),
    },
  ];

  const access = accessProblem(overview.error);
  const exportFile = data ? `overview-channels-${data.period.from}-${data.period.to}-${data.model}-${data.view}` : 'overview';
  const modelQuestion = { first_touch: t('ov.questionFirst'), last_touch: t('ov.questionLast'), position_based: t('ov.questionPosition') }[model];

  return (
    <>
      <PageHeader
        title={t('ov.titleLead')}
        accent={t('ov.titleAccent')}
        description={t('ov.description')}
        actions={
          <>
            <ExportCsvButton disabled={!data} onExport={() => data && downloadCsv(exportFile, tableCsv(columns, data.channels))} />
            <PrintButton disabled={!data} />
          </>
        }
      />
      <FilterBar label={t('m.filters')}>
        <PeriodFilter value={period} onChange={setPeriod} />
        <AttributionFilter value={model} onChange={setModel} />
        <ViewToggle value={view} onChange={setView} />
      </FilterBar>
      {data && (
        <p className="print-only">
          Picsart Academy Marketing Hub · {data.period.from} – {data.period.to} · {data.modelLabel} · {data.view === 'cohort' ? t('filter.viewCohort') : t('filter.viewPeriod')} · AMD ·{' '}
          {new Date().toISOString().slice(0, 10)}
          {data.shared && ' · counts of one or two people shown as “fewer than 3”'}
        </p>
      )}
      <OpenAlertsNotice />
      {access && (
        <AccessNotice problem={access} title="Sign in to see the Overview">
          Every staff role sees the Overview; sign in through the Core Engine.
        </AccessNotice>
      )}
      {overview.isError && !access && <Alert tone="danger" title={t('m.notLoaded')}>{overview.error.message}</Alert>}

      {overview.isPending && !access && (
        <div className="stack stack--lg" aria-busy>
          <div className="grid-12">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="span-3">
                <SkeletonTile />
              </div>
            ))}
          </div>
          <SkeletonCard />
        </div>
      )}

      {data && (
        <div className="stack stack--lg">
          <div className="grid-12">
            <div className="span-3">
              <StatTile
                tone="yellow"
                label={t('ov.subscribers')}
                value={tileValue(data.tiles.subscribers)}
                caption={t('ov.subscribersCaption')}
                definition={definitions.subscribers ?? ''}
                href={marketing ? '#/contacts' : undefined}
              />
            </div>
            <div className="span-3">
              <StatTile
                label={t('ov.clickRate')}
                value={data.tiles.newsletterClickRate.rate === null ? (data.tiles.newsletterClickRate.delivered === 0 ? '—' : null) : formatPercent(data.tiles.newsletterClickRate.rate)}
                caption={t('ov.clickRateCaption', { n: formatNumber(data.tiles.newsletterClickRate.delivered) })}
                delta={
                  data.tiles.newsletterClickRate.rate !== null && data.tiles.newsletterClickRate.previousRate
                    ? (data.tiles.newsletterClickRate.rate - data.tiles.newsletterClickRate.previousRate) / data.tiles.newsletterClickRate.previousRate
                    : undefined
                }
                definition={definitions.newsletterClickRate ?? ''}
                href={marketing ? '#/newsletter' : undefined}
              />
            </div>
            <div className="span-3">
              <StatTile
                label={t('ov.newLeads')}
                value={tileValue(data.tiles.newLeads.value)}
                caption={`${data.period.from} – ${data.period.to}`}
                delta={delta(data.tiles.newLeads.value, data.tiles.newLeads.previous)}
                definition={definitions.newLeads ?? ''}
                spark={data.shared ? undefined : data.trend.points.map((point) => chartCount(point.lead))}
              />
            </div>
            <div className="span-3">
              <StatTile
                label={t('ov.enrolledFromThem')}
                value={tileValue(data.tiles.enrolledFromLeads.value)}
                caption={t('ov.enrolledCaption')}
                delta={delta(data.tiles.enrolledFromLeads.value, data.tiles.enrolledFromLeads.previous)}
                definition={definitions.enrolledFromLeads ?? ''}
                spark={data.shared ? undefined : data.trend.points.map((point) => chartCount(point.enrolled))}
              />
            </div>
          </div>

          <section className="card stack" aria-labelledby="channel-table-heading">
            <div className="card__header">
              <div>
                <h2 id="channel-table-heading">{t('ov.outcomesByChannel')}</h2>
                <p className="muted">{modelQuestion}</p>
              </div>
              <StatusBadge tone="neutral">{data.modelLabel}</StatusBadge>
            </div>
            <DataTable
              caption={`${t('ov.outcomesByChannel')}, ${data.period.from} – ${data.period.to}, ${data.modelLabel}`}
              captionHidden
              columns={columns}
              rows={data.channels}
              rowKey={(row) => row.channel}
              initialSort={{ key: 'lead', direction: 'descending' }}
              totals={{
                channel: t('ov.allChannels'),
                lead: countText(data.totals.lead),
                enrolled: countText(data.totals.enrolled),
                hired: countText(data.totals.hired),
                cost: formatAmd(data.totals.costAmd),
                perLead: amd(data.totals.costPerLead),
                perEnrolled: <strong>{amd(data.totals.costPerEnrolled)}</strong>,
              }}
            />
            <p className="note">
              {t('ov.tableNote')}
              {data.shared && ` ${t('m.smallNumbers')}`}
              {marketing && (
                <>
                  {' '}
                  <a className="no-print" href="#/costs">
                    {t('ov.enterCosts')}
                  </a>
                </>
              )}
            </p>
          </section>

          <Suspense fallback={<SkeletonCard />}>
            <OverviewCharts data={data} name={name} bucketLabel={bucketLabel} />
          </Suspense>

          <div className="grid-12">
            <TrustCard data={data} selfReported={selfReported.data} className="span-6" />
            <div className="span-6">
              <SelfReportedCard period={period} />
            </div>
          </div>
        </div>
      )}

      {role === 'admin' && (
        <section className="card page-section no-print" aria-labelledby="api-status-heading">
          <div className="card__header">
            <h2 id="api-status-heading">{t('ov.apiStatus')}</h2>
            <Button variant="ghost" size="sm" icon={<ArrowClockwise size={16} aria-hidden />} loading={health.isFetching} onClick={() => void health.refetch()}>
              {t('ov.checkAgain')}
            </Button>
          </div>
          <div role="status" aria-live="polite" className="cluster">
            {health.isError && <Alert tone="danger" title="API unreachable">{health.error.message}. Check that the backend is running and VITE_API_URL points to it.</Alert>}
            {health.isSuccess && (
              <>
                <StatusBadge tone={health.data.status === 'ok' ? 'success' : 'warning'}>API {health.data.status}</StatusBadge>
                <StatusBadge tone={tone(health.data.database)}>Database: {health.data.database.replace('_', ' ')}</StatusBadge>
                <StatusBadge tone={tone(health.data.email.adapter)}>Email: {health.data.email.adapter}</StatusBadge>
                <StatusBadge tone={tone(health.data.integrations.mode)}>Integrations: {health.data.integrations.mode}</StatusBadge>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}

type ChannelPoint = { channel: string; name: string; enrolled: number; leads: number };
type TrendRow = { label: string; start: string; lead: number; enrolled: number };

/** Enrolled students by channel, the funnel and leads and enrollments over time. */
function OverviewCharts({ data, name, bucketLabel }: { data: Overview; name: (id: string) => string; bucketLabel: (start: string, granularity: 'week' | 'month') => string }) {
  const t = useT();
  const format = chartCountFormat(data.shared);
  const ranked: ChannelPoint[] = data.channels
    .map((row) => ({ channel: row.channel, name: name(row.channel), enrolled: chartCount(row.enrolled), leads: chartCount(row.lead) }))
    .filter((row) => !SPECIAL.has(row.channel) || row.enrolled > 0 || row.leads > 0)
    .sort((a, b) => b.enrolled - a.enrolled || b.leads - a.leads);
  const top = ranked[0];
  const stages = [
    { label: t('m.leads'), value: chartCount(data.totals.lead) },
    { label: t('m.applied'), value: chartCount(data.totals.applied) },
    { label: t('m.enrolled'), value: chartCount(data.totals.enrolled) },
    { label: t('m.completed'), value: chartCount(data.totals.completed) },
    { label: t('m.hired'), value: chartCount(data.totals.hired) },
  ];
  // The biggest drop between two steps is named in the summary (funnel guidance: highlight the largest loss).
  const drops = stages.slice(1).map((stage, i) => ({ from: stages[i]!.label, to: stage.label, rate: stages[i]!.value > 0 ? stage.value / stages[i]!.value : 1 }));
  const biggest = drops.reduce((worst, drop) => (drop.rate < worst.rate ? drop : worst), drops[0]!);
  const trend: TrendRow[] = data.trend.points.map((point) => ({ start: point.start, label: bucketLabel(point.start, data.trend.granularity), lead: chartCount(point.lead), enrolled: chartCount(point.enrolled) }));
  const peak = trend.reduce<TrendRow | null>((best, row) => (!best || row.lead > best.lead ? row : best), null);
  const noOutcomes = stages[0]!.value === 0 && stages[2]!.value === 0;

  return (
    <div className="grid-12">
      <ChartCard
        className="span-6"
        title={t('ov.enrolledByChannel')}
        description={t('ov.creditedBy', { model: data.modelLabel })}
        summary={top && top.enrolled > 0 ? t('ov.enrolledSummary', { channel: top.name, n: format(top.enrolled) }) : t('chart.noData')}
        empty={ranked.every((row) => row.enrolled === 0)}
        table={{
          columns: [
            { key: 'name', header: t('m.channel'), sortValue: (row) => row.name },
            { key: 'leads', header: t('m.leads'), numeric: true, render: (row) => format(row.leads), sortValue: (row) => row.leads },
            { key: 'enrolled', header: t('m.enrolled'), numeric: true, render: (row) => format(row.enrolled), sortValue: (row) => row.enrolled },
          ],
          rows: ranked,
          rowKey: (row) => row.channel,
        }}
      >
        <BarChart data={ranked} categoryKey="name" series={[{ key: 'enrolled', label: t('m.enrolled') }]} layout="horizontal" format={format} label={t('ov.enrolledByChannel')} />
      </ChartCard>
      <ChartCard
        className="span-6"
        title={t('ov.funnel')}
        description={t('ov.funnelHint')}
        summary={noOutcomes ? t('chart.noData') : t('ov.funnelSummary', { leads: format(stages[0]!.value), hired: format(stages[4]!.value), from: biggest.from, to: biggest.to })}
        empty={noOutcomes}
        table={{
          columns: [
            { key: 'label', header: t('m.stage') },
            { key: 'value', header: t('m.people'), numeric: true, render: (row) => format(row.value) },
          ],
          rows: stages,
          rowKey: (row) => row.label,
        }}
      >
        <FunnelChart stages={stages} format={format} label={t('ov.funnel')} />
      </ChartCard>
      <ChartCard
        className="span-12"
        title={t('ov.trend')}
        description={data.trend.granularity === 'week' ? t('ov.trendWeekly') : t('ov.trendMonthly')}
        summary={peak && peak.lead > 0 ? t('ov.trendSummary', { label: peak.label, n: format(peak.lead) }) : t('chart.noData')}
        empty={!peak || trend.every((row) => row.lead === 0 && row.enrolled === 0)}
        height={260}
        table={{
          columns: [
            { key: 'label', header: data.trend.granularity === 'week' ? t('m.weekOf') : t('m.month') },
            { key: 'lead', header: t('m.leads'), numeric: true, render: (row) => format(row.lead) },
            { key: 'enrolled', header: t('m.enrolled'), numeric: true, render: (row) => format(row.enrolled) },
          ],
          rows: trend,
          rowKey: (row) => row.start,
          exportFile: `leads-enrolled-${data.period.from}-${data.period.to}`,
        }}
      >
        <LineChart
          data={trend}
          xKey="label"
          height={260}
          format={format}
          series={[
            { key: 'lead', label: t('m.leads') },
            { key: 'enrolled', label: t('m.enrolled') },
          ]}
          label={t('ov.trend')}
        />
      </ChartCard>
    </div>
  );
}

/** "Can we trust these numbers?": M1, people without a recorded touch, the self-reported check and the model. */
function TrustCard({ data, selfReported, className }: { data: Overview; selfReported: Awaited<ReturnType<typeof getSelfReported>> | undefined; className?: string }) {
  const t = useT();
  const enrolled = numberOf(data.trust.enrolled);
  const known = numberOf(data.trust.attributedEnrolled);
  const m1 = enrolled && known !== null ? known / enrolled : null;
  const pct = (value: number) => formatPercent(value, undefined, { maximumFractionDigits: 0 });
  return (
    <section className={['card', 'stack', className].filter(Boolean).join(' ')} aria-labelledby="trust-heading">
      <h2 id="trust-heading">{t('ov.trust')}</h2>
      <dl className="facts facts--compact">
        <div>
          <dt>{t('ov.m1')}</dt>
          <dd>
            {enrolled === 0 ? (
              t('ov.m1None')
            ) : m1 === null ? (
              countText(data.trust.attributedEnrolled)
            ) : (
              <>
                {t('ov.m1Value', { pct: pct(m1), n: countText(data.trust.enrolled) })}{' '}
                <StatusBadge tone={m1 >= 0.9 ? 'success' : 'warning'}>{m1 >= 0.9 ? t('ov.meetsTarget') : t('ov.belowTarget')}</StatusBadge>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('ov.unattributed')}</dt>
          <dd className="num">{t('ov.unattributedValue', { leads: countText(data.trust.unattributed.lead), enrolled: countText(data.trust.unattributed.enrolled) })}</dd>
        </div>
        <div>
          <dt>{t('ov.unmapped')}</dt>
          <dd className="num">
            {t('ov.unattributedValue', { leads: countText(data.trust.unmapped.lead), enrolled: countText(data.trust.unmapped.enrolled) })}{' '}
            <a className="no-print" href="#/data-health">
              {t('ov.reviewUnmapped')}
            </a>
          </dd>
        </div>
        <div>
          <dt>{t('ov.selfReported')}</dt>
          <dd>
            {!selfReported
              ? '—'
              : selfReported.agreementRate === null
                ? selfReported.compared === 0
                  ? t('ov.selfReportedNone')
                  : countText(selfReported.compared)
                : t('ov.selfReportedValue', { pct: pct(selfReported.agreementRate), n: countText(selfReported.compared) })}
          </dd>
        </div>
        <div>
          <dt>{t('ov.model')}</dt>
          <dd>{t('ov.modelValue', { model: data.modelLabel })}</dd>
        </div>
      </dl>
      <div className="inset cluster cluster--nowrap callout">
        <Info size={20} weight="bold" aria-hidden />
        <p>{t('ov.causeWarning')}</p>
      </div>
    </section>
  );
}

/** One line about open alerts; the list and Resolve live on the Alerts page (sidebar badge). */
function OpenAlertsNotice() {
  const t = useT();
  const role = useStaffRole();
  const alerts = useQuery({ queryKey: ['alerts', role], queryFn: listAlerts, refetchInterval: 60_000 });
  const open = alerts.data?.alerts.filter((alert) => !alert.resolvedAt) ?? [];
  if (open.length === 0) return null;
  const critical = open.some((alert) => alert.level === 'critical');
  return (
    <div className="no-print page-notice">
      <Alert
        tone={critical ? 'danger' : 'warning'}
        title={t('ov.alerts', { n: open.length })}
        action={
          <a className="btn btn--secondary btn--sm" href="#/alerts">
            {t('ov.openAlerts')}
          </a>
        }
      >
        {open[0]!.title}
        {open.length > 1 && ` ${t('ov.andMore', { n: open.length - 1 })}`}
      </Alert>
    </div>
  );
}
