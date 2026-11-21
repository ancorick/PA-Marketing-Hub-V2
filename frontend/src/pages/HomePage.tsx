import { ArrowClockwise, FilePdf } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { getHealth, getOverview, listAnalyticsChannels, type Count, type OverviewRow } from '../lib/api';
import { formatAmd, formatPercent } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { AccessNotice, accessProblem, Alert, Button, DataTable, PageHeader, StatTile, StatusBadge, type Column, type Tone } from '../ui';
import { AlertsPanel } from './AlertsPanel';
import { channelLabel, CountCell, countCsv, countText, peoplePath } from './analytics/numbers';
import { ModelSwitch, PeriodPicker, useModel, usePeriod } from './analytics/period';
import { SelfReportedCard } from './analytics/SelfReportedCard';

function tone(value: string): Tone {
  if (value === 'ok') return 'success';
  if (value === 'embedded' || value === 'mock' || value === 'log') return 'warning';
  return 'danger';
}

const MARKETING = ['editor', 'marketing_manager', 'admin'];
const delta = (value: Count, previous: Count) =>
  typeof value === 'number' && typeof previous === 'number' && previous > 0 ? (value - previous) / previous : undefined;
const tileValue = (value: Count) => (value === 'fewer_than_3' ? null : countText(value));

/** Overview (PRD 9.6, ANL-08): headline tiles and the channel table for any period, under one named model. */
export function HomePage() {
  const role = useStaffRole();
  const marketing = MARKETING.includes(role);
  const [period, setPeriod] = usePeriod();
  const [model, setModel] = useModel();
  const overview = useQuery({ queryKey: ['overview', role, period, model], queryFn: () => getOverview(period, model) });
  const channels = useQuery({ queryKey: ['analytics-channels', role], queryFn: listAnalyticsChannels, staleTime: Infinity });
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth, retry: 1 });
  const data = overview.data;
  const definitions = data?.definitions ?? {};
  const modelNote = data ? ` Attribution: ${data.modelLabel}.` : '';

  const people = (stage: 'lead' | 'enrolled' | 'hired', row: OverviewRow) => (marketing ? peoplePath(stage, row.channel) : null);
  const columns: Column<OverviewRow>[] = [
    {
      key: 'channel',
      header: 'Channel',
      render: (row) =>
        row.channel in { unmapped: 1, unattributed: 1 } ? (
          <span className="muted nowrap">{channelLabel(row.channel, channels.data?.channels)}</span>
        ) : (
          <a className="nowrap" href={`#/analytics/channels/${row.channel}`}>{channelLabel(row.channel, channels.data?.channels)}</a>
        ),
      sortValue: (row) => channelLabel(row.channel, channels.data?.channels),
    },
    ...(['lead', 'enrolled', 'hired'] as const).map(
      (stage): Column<OverviewRow> => ({
        key: stage,
        header: { lead: 'Leads', enrolled: 'Enrolled', hired: 'Hired' }[stage],
        numeric: true,
        definition: `${definitions[stage] ?? ''}${modelNote}`,
        render: (row) => <CountCell value={row[stage]} href={people(stage, row)} label={stage} />,
        csv: (row) => countCsv(row[stage]),
        sortValue: (row) => (row[stage] === 'fewer_than_3' ? 1.5 : (row[stage] as number)),
      }),
    ),
    { key: 'cost', header: 'Channel cost', numeric: true, definition: definitions.channelCost, render: (row) => formatAmd(row.costAmd), sortValue: (row) => row.costAmd },
    {
      key: 'perEnrolled',
      header: 'Cost per enrolled student',
      numeric: true,
      definition: `${definitions.costPerEnrolled ?? ''}${modelNote}`,
      render: (row) => (row.costPerEnrolled === null ? <span className="muted">—</span> : <strong>{formatAmd(row.costPerEnrolled)}</strong>),
      sortValue: (row) => row.costPerEnrolled ?? -1,
      csv: (row) => row.costPerEnrolled,
    },
  ];

  const access = accessProblem(overview.error);
  return (
    <>
      <PageHeader
        title="Overview"
        description="Who the marketing brings in, who enrolls and who gets hired, and what each channel costs."
        actions={
          <Button className="no-print" variant="secondary" icon={<FilePdf size={18} aria-hidden />} disabled={!overview.data} onClick={() => window.print()}>
            Export PDF
          </Button>
        }
      />
      {data && (
        <p className="print-only">
          Picsart Academy Marketing Hub · {data.period.from} to {data.period.to} · {data.modelLabel} · costs in AMD · printed {new Date().toISOString().slice(0, 10)}
          {data.shared && ' · counts of one or two people shown as “fewer than 3”'}
        </p>
      )}
      <div className="no-print">
        <AlertsPanel />
      </div>
      <div className="cluster cluster--md page-section no-print">
        <ModelSwitch model={model} onChange={setModel} />
      </div>
      <div className="no-print">
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>
      {access && (
        <AccessNotice problem={access} title="Sign in to see the Overview">
          Every staff role sees the Overview; sign in through the Core Engine.
        </AccessNotice>
      )}
      {overview.isError && !access && <Alert tone="danger" title="Overview not loaded">{overview.error.message}</Alert>}
      {data && (
        <div className="stack stack--lg">
          <div className="tiles">
            <StatTile
              tone="yellow"
              label="Subscribers"
              value={tileValue(data.tiles.subscribers)}
              definition={definitions.subscribers ?? ''}
              href={marketing ? '#/audience' : undefined}
            />
            <StatTile
              label="Newsletter click rate"
              value={data.tiles.newsletterClickRate.rate === null ? (data.tiles.newsletterClickRate.delivered === 0 ? '—' : null) : formatPercent(data.tiles.newsletterClickRate.rate)}
              delta={
                data.tiles.newsletterClickRate.rate !== null && data.tiles.newsletterClickRate.previousRate
                  ? (data.tiles.newsletterClickRate.rate - data.tiles.newsletterClickRate.previousRate) / data.tiles.newsletterClickRate.previousRate
                  : undefined
              }
              definition={definitions.newsletterClickRate ?? ''}
              href={marketing ? '#/newsletter' : undefined}
            />
            <StatTile
              label="New leads"
              value={tileValue(data.tiles.newLeads.value)}
              delta={delta(data.tiles.newLeads.value, data.tiles.newLeads.previous)}
              definition={definitions.newLeads ?? ''}
            />
            <StatTile
              label="Enrolled from them"
              value={tileValue(data.tiles.enrolledFromLeads.value)}
              delta={delta(data.tiles.enrolledFromLeads.value, data.tiles.enrolledFromLeads.previous)}
              definition={definitions.enrolledFromLeads ?? ''}
            />
          </div>

          <section className="card stack" aria-labelledby="channel-table-heading">
            <div className="card__header">
              <h2 id="channel-table-heading">Channels</h2>
              <StatusBadge tone="neutral">{data.modelLabel}</StatusBadge>
            </div>
            <p className="muted">
              Outcomes in the period credited by {data.modelLabel.toLowerCase()}; cost in AMD. Open a channel for its funnel, campaigns and 12-month trend.
              {data.shared && ' Counts of one or two people show as “fewer than 3”.'}
            </p>
            <DataTable
              caption={`Channels, ${data.period.from} to ${data.period.to}, ${data.modelLabel}`}
              captionHidden
              columns={columns}
              rows={data.channels}
              rowKey={(row) => row.channel}
              initialSort={{ key: 'lead', direction: 'descending' }}
              exportFile={`overview-channels-${data.period.from}-${data.period.to}-${data.model}`}
              footer={
                <tr>
                  <th scope="row">Total</th>
                  <td className="is-num">{countText(data.totals.lead)}</td>
                  <td className="is-num">{countText(data.totals.enrolled)}</td>
                  <td className="is-num">{countText(data.totals.hired)}</td>
                  <td className="is-num">{formatAmd(data.totals.costAmd)}</td>
                  <td className="is-num">
                    <strong>{data.totals.costPerEnrolled === null ? '—' : formatAmd(data.totals.costPerEnrolled)}</strong>
                  </td>
                </tr>
              }
            />
            {marketing && (
              <p className="no-print">
                <a href="#/analytics/costs">Enter manual costs</a>
              </p>
            )}
          </section>
          <SelfReportedCard period={period} />
        </div>
      )}

      {role === 'admin' && (
        <section className="card page-section no-print" aria-labelledby="api-status-heading">
          <div className="card__header">
            <h2 id="api-status-heading">API status</h2>
            <Button variant="ghost" size="sm" icon={<ArrowClockwise size={16} aria-hidden />} loading={health.isFetching} onClick={() => void health.refetch()}>
              Check again
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
