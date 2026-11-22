import { CalendarPlus, DownloadSimple, FilmStrip, Images } from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { downloadAttendees, listEvents, type Count, type EventList, type EventRow } from '../lib/api';
import { formatAmd, formatNumber } from '../lib/format';
import { useT, type StringKey } from '../lib/i18n';
import { yerevanToday } from '../lib/periods';
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
  Drawer,
  FilterBar,
  PageHeader,
  PeriodFilter,
  SkeletonCard,
  SkeletonTile,
  StatTile,
  StatusBadge,
  tableCsv,
  Tag,
  type Column,
} from '../ui';
import { CountCell, countCsv, countText, countValue } from './analytics/numbers';
import { useModel, usePeriod } from './analytics/period';
import { ManualEvents } from './ManualEvents';
import { amd, BarChart, chartCount, chartCountFormat, ExportCsvButton, FunnelChart, modelName, useDateTimeLabel, useDayLabel } from './measure/shared';

const MARKETING = ['editor', 'marketing_manager', 'admin'];
export const EVENT_TYPE_KEY: Record<string, StringKey> = {
  open_day: 'ev.type.open_day',
  workshop: 'ev.type.workshop',
  info_session: 'ev.type.info_session',
  meetup: 'ev.type.meetup',
  graduation: 'ev.type.graduation',
  guest_visit: 'ev.type.guest_visit',
  other: 'ev.type.other',
};
const tile = (value: Count | undefined) => (value === undefined ? '—' : value === 'fewer_than_3' ? null : countText(value));
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Events (PRD 9.6, 10, EVT-05; RESTRUCTURE R4): events as a channel under the chosen attribution model,
 * upcoming events for the newsletter, registrations → attendance → leads, and the manual event form in a side
 * panel while Event Hub is not connected.
 */
export function EventsPage() {
  const t = useT();
  const role = useStaffRole();
  const marketing = MARKETING.includes(role);
  const [period, setPeriod] = usePeriod();
  const [model, setModel] = useModel();
  const [adding, setAdding] = useState(false);
  const today = yerevanToday();
  const list = useQuery({ queryKey: ['events', role, period, model], queryFn: () => listEvents(period, model) });
  const upcoming = useQuery({ queryKey: ['events', role, 'upcoming', today], queryFn: () => listEvents({ from: today, to: shift(today, 365) }) });
  const access = accessProblem(list.error);
  const data = list.data;
  const dayLabel = useDayLabel();
  const typeLabel = (type: string) => t(EVENT_TYPE_KEY[type] ?? 'ev.type.other');
  const time = useDateTimeLabel();
  const download = useMutation({ mutationFn: (event: EventRow) => downloadAttendees(event.id, event.title) });
  const modelNote = data?.modelLabel ? ` ${t('m.attributionNote', { model: modelName(t, data.modelLabel) })}` : '';

  const credited = (key: 'lead' | 'enrolled' | 'hired', header: string, definition: string): Column<EventRow> => ({
    key,
    header,
    numeric: true,
    definition: `${definition}${modelNote}`,
    render: (row) => (row.credited ? <CountCell value={row.credited[key]} label={key} /> : '—'),
    sortValue: (row) => (row.credited ? countValue(row.credited[key]) : -1),
    csv: (row) => (row.credited ? countCsv(row.credited[key]) : null),
  });
  const columns: Column<EventRow>[] = [
    {
      key: 'event',
      header: t('ev.event'),
      render: (row) => (
        <span className="stack stack--xs">
          <strong className="text-wrap">{row.title}</strong>
          <span className="muted text-xs">
            {typeLabel(row.type)} · {row.source === 'manual' ? t('ev.manual') : 'Event Hub'}
          </span>
        </span>
      ),
      sortValue: (row) => row.title,
      csv: (row) => row.title,
    },
    { key: 'date', header: t('ev.date'), render: (row) => <span className="num nowrap">{dayLabel(row.startsAt, true)}</span>, sortValue: (row) => row.startsAt, csv: (row) => row.startsAt.slice(0, 10) },
    { key: 'cost', header: t('ev.cost'), numeric: true, definition: t('ev.costDefinition'), render: (row) => formatAmd(row.costAmd), sortValue: (row) => row.costAmd },
    {
      key: 'registrations',
      header: t('ev.registered'),
      numeric: true,
      definition: t('ev.registeredDefinition'),
      render: (row) => <CountCell value={row.registrations} label="registrations" />,
      sortValue: (row) => countValue(row.registrations),
      csv: (row) => countCsv(row.registrations),
    },
    {
      key: 'attendees',
      header: t('ev.attended'),
      numeric: true,
      definition: t('ev.attendedDefinition'),
      render: (row) => <CountCell value={row.attendees} label="attendees" />,
      sortValue: (row) => countValue(row.attendees),
      csv: (row) => countCsv(row.attendees),
    },
    credited('lead', t('m.leads'), t('ev.creditedDefinition')),
    credited('enrolled', t('m.enrolled'), t('ev.creditedDefinition')),
    credited('hired', t('m.hired'), t('ev.creditedDefinition')),
    {
      key: 'perEnrolled',
      header: t('m.costPerEnrolled'),
      numeric: true,
      definition: `${t('ev.perEnrolledDefinition')}${modelNote}`,
      render: (row) => <span className={row.costPerEnrolled === null ? 'muted' : undefined}>{amd(row.costPerEnrolled)}</span>,
      sortValue: (row) => row.costPerEnrolled ?? -1,
      csv: (row) => row.costPerEnrolled,
    },
    {
      key: 'files',
      header: marketing ? t('ev.files') : t('ev.media'),
      render: (row) => {
        const csv = marketing && countValue(row.registrations) > 0;
        if (!csv && !row.recordingUrl && !row.photosUrl) return <span className="muted">—</span>;
        return (
          <span className="cluster cluster--nowrap">
            {csv && (
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<DownloadSimple size={18} aria-hidden />}
                loading={download.isPending && download.variables?.id === row.id}
                onClick={() => download.mutate(row)}
                aria-label={t('ev.downloadAttendees', { event: row.title })}
                title={t('ev.attendeesCsv')}
              />
            )}
            {row.recordingUrl && (
              <a className="icon-link" href={row.recordingUrl} target="_blank" rel="noreferrer" aria-label={`${t('ev.recording', { event: row.title })}${row.mediaPublic ? '' : ` (${t('ev.internal')})`}`} title={`${t('ev.recording', { event: row.title })}${row.mediaPublic ? '' : ` (${t('ev.internal')})`}`}>
                <FilmStrip size={18} aria-hidden />
              </a>
            )}
            {row.photosUrl && (
              <a className="icon-link" href={row.photosUrl} target="_blank" rel="noreferrer" aria-label={`${t('ev.photos', { event: row.title })}${row.mediaPublic ? '' : ` (${t('ev.internal')})`}`} title={`${t('ev.photos', { event: row.title })}${row.mediaPublic ? '' : ` (${t('ev.internal')})`}`}>
                <Images size={18} aria-hidden />
              </a>
            )}
          </span>
        );
      },
      csv: (row) => [row.recordingUrl, row.photosUrl].filter(Boolean).join(' '),
    },
  ];

  const upcomingRows = (upcoming.data?.events ?? []).filter((row) => Date.parse(row.startsAt) >= Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const upcomingColumns: Column<EventRow>[] = [
    {
      key: 'event',
      header: t('ev.event'),
      render: (row) => (
        <span className="stack stack--xs">
          <strong className="text-wrap">{row.title}</strong>
          <span className="muted text-xs">{typeLabel(row.type)}</span>
        </span>
      ),
      sortValue: (row) => row.title,
    },
    { key: 'date', header: t('ev.date'), render: (row) => <span className="num nowrap">{time(row.startsAt)}</span>, sortValue: (row) => row.startsAt },
    {
      key: 'public',
      header: t('ev.visibility'),
      render: (row) => (row.public ? <StatusBadge tone="success">{t('ev.public')}</StatusBadge> : <StatusBadge tone="neutral">{t('ev.private')}</StatusBadge>),
      sortValue: (row) => (row.public ? 1 : 0),
    },
    {
      key: 'registration',
      header: t('ev.registration'),
      render: (row) => (row.registrationUrl ? <a href={row.registrationUrl} target="_blank" rel="noreferrer">{row.registrationOpen ? t('ev.open') : t('ev.closed')}</a> : <span className="muted">—</span>),
    },
    { key: 'registrations', header: t('ev.registered'), numeric: true, render: (row) => countText(row.registrations), sortValue: (row) => countValue(row.registrations) },
    { key: 'source', header: t('ev.source'), render: (row) => <Tag>{row.source === 'manual' ? t('ev.manual') : 'Event Hub'}</Tag>, sortValue: (row) => row.source },
  ];

  return (
    <>
      <PageHeader
        title={t('nav.events')}
        description={t('ev.description')}
        actions={
          <>
            <ExportCsvButton disabled={!data?.events.length} onExport={() => data && downloadCsv(`events-${data.period.from}-${data.period.to}-${model}`, tableCsv(columns, data.events))} />
            {marketing && (
              <Button variant="primary" icon={<CalendarPlus size={18} weight="bold" aria-hidden />} onClick={() => setAdding(true)}>
                {t('ev.addManually')}
              </Button>
            )}
          </>
        }
      />
      <FilterBar label={t('m.filters')}>
        <PeriodFilter value={period} onChange={setPeriod} />
        <AttributionFilter value={model} onChange={setModel} />
      </FilterBar>
      {access ? (
        <AccessNotice problem={access} title={t('ev.access')}>
          {t('ev.accessHint')}
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          {list.isError && <Alert tone="danger" title={t('m.notLoaded')}>{list.error.message}</Alert>}
          {download.isError && <Alert tone="danger" title={t('ev.downloadFailed')}>{download.error.message}</Alert>}
          <div className="grid-12">
            {!data ? (
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="span-3">
                  <SkeletonTile />
                </div>
              ))
            ) : (
              <>
                <div className="span-3">
                  <StatTile tone="yellow" label={t('ev.tileAttendees')} value={tile(data.totals.attendees)} caption={t('ev.tileAttendeesCaption', { n: countText(data.totals.registrations), events: data.events.length })} definition={t('ev.attendedDefinition')} />
                </div>
                <div className="span-3">
                  <StatTile label={t('ev.tileLeads')} value={tile(data.totals.credited?.lead)} caption={t('ev.afterRegistering', { n: countText(data.totals.leads) })} definition={`${t('ev.creditedDefinition')}${modelNote}`} />
                </div>
                <div className="span-3">
                  <StatTile label={t('ev.tileEnrolled')} value={tile(data.totals.credited?.enrolled)} caption={t('ev.afterRegistering', { n: countText(data.totals.enrolled) })} definition={`${t('ev.creditedDefinition')}${modelNote}`} />
                </div>
                <div className="span-3">
                  <StatTile label={t('ev.tileCost')} value={formatAmd(data.totals.costAmd)} caption={data.totals.costPerEnrolled ? t('ev.perEnrolledCaption', { amount: formatAmd(data.totals.costPerEnrolled) }) : undefined} definition={t('ev.costDefinition')} />
                </div>
              </>
            )}
          </div>

          <section className="card stack" aria-labelledby="upcoming-heading">
            <div>
              <h2 id="upcoming-heading">{t('ev.upcoming')}</h2>
              <p className="muted">{t('ev.upcomingHint')}</p>
            </div>
            <DataTable caption={t('ev.upcoming')} captionHidden columns={upcomingColumns} rows={upcomingRows} rowKey={(row) => row.id} loading={upcoming.isPending} initialSort={{ key: 'date', direction: 'ascending' }} empty={t('ev.noUpcoming')} />
          </section>

          {data && (
            <Suspense fallback={<SkeletonCard />}>
              <EventCharts data={data} />
            </Suspense>
          )}

          <section className="card stack" aria-labelledby="channel-heading">
            <div className="card__header">
              <div>
                <h2 id="channel-heading">{t('ev.asChannel')}</h2>
                <p className="muted">{t('ev.asChannelHint')}</p>
              </div>
              {data?.modelLabel && <StatusBadge tone="neutral">{modelName(t, data.modelLabel)}</StatusBadge>}
            </div>
            <DataTable
              caption={t('ev.asChannel')}
              captionHidden
              columns={columns}
              rows={data?.events ?? []}
              rowKey={(row) => row.id}
              loading={list.isPending}
              initialSort={{ key: 'date', direction: 'descending' }}
              pageSize={15}
              dense
              empty={t('ev.noEvents')}
              totals={
                data && {
                  event: t('table.total'),
                  cost: formatAmd(data.totals.costAmd),
                  registrations: countText(data.totals.registrations),
                  attendees: countText(data.totals.attendees),
                  lead: data.totals.credited ? countText(data.totals.credited.lead) : '—',
                  enrolled: data.totals.credited ? countText(data.totals.credited.enrolled) : '—',
                  hired: data.totals.credited ? countText(data.totals.credited.hired) : '—',
                  perEnrolled: amd(data.totals.costPerEnrolled),
                }
              }
            />
            {data?.shared && <p className="note">{t('m.smallNumbers')}</p>}
          </section>
        </div>
      )}
      {marketing && (
        <Drawer open={adding} onClose={() => setAdding(false)} title={t('ev.addManually')} description={t('ev.addManuallyHint')}>
          <ManualEvents events={data?.events ?? []} stacked />
        </Drawer>
      )}
    </>
  );
}

type EventBars = { id: string; label: string; registrations: number; attendees: number; leads: number };

/** Registrations → attendance → leads: per event (latest twelve) and for the whole period. */
function EventCharts({ data }: { data: EventList }) {
  const t = useT();
  const dayLabel = useDayLabel();
  const format = chartCountFormat(data.shared);
  const recent: EventBars[] = [...data.events]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(-12)
    .map((row) => ({ id: row.id, label: `${dayLabel(row.startsAt)} · ${row.title}`, registrations: chartCount(row.registrations), attendees: chartCount(row.attendees), leads: chartCount(row.leads) }));
  const stages = [
    { label: t('ev.registered'), value: chartCount(data.totals.registrations) },
    { label: t('ev.attended'), value: chartCount(data.totals.attendees) },
    { label: t('m.leads'), value: chartCount(data.totals.leads) },
    { label: t('m.enrolled'), value: chartCount(data.totals.enrolled) },
  ];
  const showRate = stages[0]!.value > 0 ? Math.round((stages[1]!.value / stages[0]!.value) * 100) : null;
  return (
    <div className="grid-12">
      <ChartCard
        className="span-6"
        title={t('ev.perEvent')}
        description={t('ev.perEventHint')}
        summary={showRate === null ? t('chart.noData') : t('ev.perEventSummary', { pct: `${showRate}%` })}
        empty={recent.length === 0}
        table={{
          columns: [
            { key: 'label', header: t('ev.event') },
            { key: 'registrations', header: t('ev.registered'), numeric: true, render: (row) => format(row.registrations) },
            { key: 'attendees', header: t('ev.attended'), numeric: true, render: (row) => format(row.attendees) },
            { key: 'leads', header: t('m.leads'), numeric: true, render: (row) => format(row.leads) },
          ],
          rows: recent,
          rowKey: (row) => row.id,
        }}
      >
        <BarChart
          data={recent}
          categoryKey="label"
          layout="horizontal"
          format={format}
          series={[
            { key: 'registrations', label: t('ev.registered') },
            { key: 'attendees', label: t('ev.attended') },
            { key: 'leads', label: t('m.leads') },
          ]}
          label={t('ev.perEvent')}
        />
      </ChartCard>
      <ChartCard
        className="span-6"
        title={t('ev.funnel')}
        description={t('ev.funnelHint')}
        summary={stages[0]!.value > 0 ? t('ev.funnelSummary', { registered: format(stages[0]!.value), enrolled: format(stages[3]!.value) }) : t('chart.noData')}
        empty={stages[0]!.value === 0}
        table={{
          columns: [
            { key: 'label', header: t('m.stage') },
            { key: 'value', header: t('m.people'), numeric: true, render: (row) => format(row.value) },
          ],
          rows: stages,
          rowKey: (row) => row.label,
        }}
      >
        <FunnelChart stages={stages} format={format} label={t('ev.funnel')} />
      </ChartCard>
      <p className="note span-12">{t('ev.chartsNote', { n: formatNumber(data.events.length) })}</p>
    </div>
  );
}
