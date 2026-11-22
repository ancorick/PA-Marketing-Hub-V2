import { EnvelopeSimple, Plus } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useId, useState } from 'react';
import { listSegments, listSendStats, listSends, type Send, type SendStats } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { useT, type StringKey } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, ChartCard, DataTable, downloadCsv, EmptyState, PageHeader, retryServerErrors, SkeletonCard, SkeletonTile, StatTile, StatusBadge, TabPanel, Tabs, tableCsv, type Column } from '../../ui';
import { BarChart, ExportCsvButton, LineChart, PrintButton, useDateTimeLabel, useDayLabel } from '../measure/shared';
import { KillSwitchBanner } from '../KillSwitch';
import { percentPoints, percentText, ratio, SEND_TONE } from './shared';

type Kind = Send['kind'];
const KINDS: Kind[] = ['campaign', 'newsletter', 'reengagement'];
const TAB_KEY: Record<Kind, StringKey> = { campaign: 'ce.tab.campaign', newsletter: 'ce.tab.newsletter', reengagement: 'ce.tab.reengagement' };
const EMPTY_KEY: Record<Kind, StringKey> = { campaign: 'ce.emptyCampaign', newsletter: 'ce.emptyNewsletter', reengagement: 'ce.emptyReengagement' };

type Row = Send & { stats: SendStats | null; segmentName: string | null };

/** The moment a send goes (or went) out: when it started, else when it is scheduled. */
const momentOf = (send: Send): string | null => send.startedAt ?? send.scheduledAt;

/**
 * Campaign emails (PRD 13.2, Flow B; RESTRUCTURE R5): campaigns, newsletter sends and re-engagement mails of the
 * last months with their results, as tables, tiles and charts. Each name opens the editor or the send report.
 */
export function CampaignEmailsPage() {
  const t = useT();
  const role = useStaffRole();
  const day = useDayLabel();
  const dateTime = useDateTimeLabel();
  const idBase = useId();
  const [kind, setKind] = useState<Kind>('campaign');
  const sends = useQuery({ queryKey: ['sends', role], queryFn: listSends, retry: retryServerErrors });
  const stats = useQuery({ queryKey: ['send-stats', role], queryFn: listSendStats, retry: retryServerErrors });
  const segments = useQuery({ queryKey: ['segments', role], queryFn: listSegments, retry: retryServerErrors });
  const access = accessProblem(sends.error);

  const all: Row[] = (sends.data?.sends ?? []).map((send) => ({
    ...send,
    stats: stats.data?.stats.find((item) => item.sendId === send.id) ?? null,
    segmentName: segments.data?.segments.find((segment) => segment.id === send.segmentId)?.name ?? null,
  }));
  const rows = all.filter((row) => row.kind === kind);
  const count = (value: Kind) => all.filter((row) => row.kind === value).length;
  const clickRate = (row: Row) => (row.stats ? ratio(row.stats.clicked, row.stats.sent) : null);
  const unsubRate = (row: Row) => (row.stats ? ratio(row.stats.unsubscribed, row.stats.sent) : null);
  const bounceRate = (row: Row) => (row.stats ? ratio(row.stats.hardBounced, row.stats.sent) : null);

  const sum = (pick: (stats: SendStats) => number) => rows.reduce((total, row) => total + (row.stats ? pick(row.stats) : 0), 0);
  const sent = sum((s) => s.sent);
  const clicked = sum((s) => s.clicked);
  const unsubscribed = sum((s) => s.unsubscribed);
  const hardBounced = sum((s) => s.hardBounced);
  const withResults = rows.filter((row) => row.stats && row.stats.sent > 0).sort((a, b) => (momentOf(a) ?? '').localeCompare(momentOf(b) ?? ''));
  const percentFormat = (value: number) => `${formatNumber(value, undefined, { maximumFractionDigits: 1 })}%`;

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('ce.name'),
      render: (row) => (
        <span className="stack stack--xs">
          <a href={`#/campaign-emails/${row.id}`}>{row.name}</a>
          {row.subject && <span className="muted text-xs text-wrap">{row.subject}</span>}
        </span>
      ),
      sortValue: (row) => row.name,
      csv: (row) => row.name,
    },
    { key: 'status', header: t('ce.status'), render: (row) => <StatusBadge tone={SEND_TONE[row.status]}>{t(`s.send.${row.status}`)}</StatusBadge>, sortValue: (row) => row.status, csv: (row) => t(`s.send.${row.status}`) },
    { key: 'segment', header: t('ce.segment'), render: (row) => row.segmentName ?? <span className="muted">—</span>, sortValue: (row) => row.segmentName ?? '', csv: (row) => row.segmentName ?? '' },
    {
      key: 'when',
      header: t('ce.when'),
      render: (row) => (momentOf(row) ? <span className="num nowrap">{dateTime(momentOf(row)!)}</span> : <span className="muted">{t('ce.notYet')}</span>),
      sortValue: (row) => momentOf(row) ?? '',
      csv: (row) => momentOf(row) ?? '',
    },
    { key: 'sent', header: t('s.sent'), numeric: true, render: (row) => formatNumber(row.stats?.sent ?? row.sentCount), sortValue: (row) => row.stats?.sent ?? row.sentCount },
    {
      key: 'click',
      header: t('s.clickRate'),
      definition: t('s.clickRateDefinition'),
      numeric: true,
      render: (row) => percentText(clickRate(row)),
      sortValue: (row) => clickRate(row) ?? -1,
      csv: (row) => (clickRate(row) === null ? null : percentPoints(clickRate(row))),
      bar: (row) => clickRate(row),
    },
    { key: 'unsub', header: t('s.unsubscribed'), numeric: true, render: (row) => (row.stats ? formatNumber(row.stats.unsubscribed) : '—'), sortValue: (row) => row.stats?.unsubscribed ?? -1 },
    {
      key: 'bounce',
      header: t('s.hardBounces'),
      definition: t('s.hardBouncesDefinition'),
      numeric: true,
      render: (row) => percentText(bounceRate(row)),
      sortValue: (row) => bounceRate(row) ?? -1,
      csv: (row) => (bounceRate(row) === null ? null : percentPoints(bounceRate(row))),
    },
  ];

  const ranked = [...withResults].sort((a, b) => (clickRate(b) ?? 0) - (clickRate(a) ?? 0)).slice(0, 10).map((row) => ({ name: row.name, rate: percentPoints(clickRate(row)) }));
  const timeline = withResults.map((row) => ({
    id: row.id,
    label: day(momentOf(row)!),
    name: row.name,
    click: percentPoints(clickRate(row)),
    unsub: percentPoints(unsubRate(row)),
    bounce: percentPoints(bounceRate(row)),
  }));
  const last = timeline.at(-1);
  const loading = sends.isPending || stats.isPending;

  return (
    <>
      <PageHeader
        title={t('nav.campaignEmails')}
        description={t('ce.description')}
        actions={
          !access && (
            <>
              <ExportCsvButton disabled={rows.length === 0} onExport={() => downloadCsv(`campaign-emails-${kind}`, tableCsv(columns, rows))} />
              <PrintButton disabled={rows.length === 0} />
              <a className="btn btn--primary" href="#/campaign-emails/new">
                <Plus size={18} weight="bold" aria-hidden />
                {t('ce.new')}
              </a>
            </>
          )
        }
      />
      {access ? (
        <AccessNotice problem={access} title={t('ce.access')}>
          {t('ce.accessHint')}
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          <KillSwitchBanner />
          {sends.isError && <Alert tone="danger" title={t('s.notLoaded')}>{sends.error.message}</Alert>}
          <Tabs idBase={idBase} label={t('ce.tabs')} value={kind} onChange={setKind} tabs={KINDS.map((id) => ({ id, label: t(TAB_KEY[id]), count: sends.data ? count(id) : undefined }))} />
          <TabPanel idBase={idBase} id={kind}>
            <div className="stack stack--lg">
              <div className="grid-12">
                {loading ? (
                  [0, 1, 2, 3].map((i) => (
                    <div key={i} className="span-3">
                      <SkeletonTile />
                    </div>
                  ))
                ) : (
                  <>
                    <div className="span-3">
                      <StatTile tone="yellow" label={t('ce.tileSent')} value={formatNumber(sent)} caption={t('ce.tileSentCaption', { n: formatNumber(rows.length) })} definition={t('ce.tileSentDefinition')} />
                    </div>
                    <div className="span-3">
                      <StatTile
                        label={t('s.clickRate')}
                        value={percentText(ratio(clicked, sent))}
                        caption={t('ce.tileClickCaption')}
                        definition={t('s.clickRateDefinition')}
                        spark={timeline.length > 1 ? timeline.map((point) => point.click) : undefined}
                      />
                    </div>
                    <div className="span-3">
                      <StatTile label={t('s.unsubscribeRate')} value={percentText(ratio(unsubscribed, sent))} caption={t('ce.tileUnsubCaption', { n: formatNumber(unsubscribed) })} definition={t('s.unsubscribeRateDefinition')} higherIsBetter={false} />
                    </div>
                    <div className="span-3">
                      <StatTile label={t('s.hardBounces')} value={percentText(ratio(hardBounced, sent))} caption={t('ce.tileBounceCaption')} definition={t('s.hardBouncesDefinition')} higherIsBetter={false} />
                    </div>
                  </>
                )}
              </div>
              <div className="grid-12">
                <Suspense fallback={<SkeletonCard />}>
                  <ChartCard
                    className="span-5"
                    title={t('ce.chartClick')}
                    description={t('ce.chartClickHint')}
                    definition={t('s.clickRateDefinition')}
                    summary={ranked[0] ? t('ce.chartClickSummary', { name: ranked[0].name, rate: percentFormat(ranked[0].rate) }) : t('chart.noData')}
                    loading={loading}
                    empty={!loading && ranked.length === 0}
                    table={{
                      columns: [
                        { key: 'name', header: t('ce.name'), sortValue: (row) => row.name },
                        { key: 'rate', header: t('s.clickRate'), numeric: true, render: (row) => percentFormat(row.rate), sortValue: (row) => row.rate },
                      ],
                      rows: ranked,
                      rowKey: (row) => row.name,
                      exportFile: 'campaign-emails-click-rate',
                    }}
                  >
                    <BarChart data={ranked} categoryKey="name" layout="horizontal" series={[{ key: 'rate', label: t('s.clickRate') }]} format={percentFormat} label={t('ce.chartClick')} />
                  </ChartCard>
                  <ChartCard
                    className="span-7"
                    title={t('ce.chartRates')}
                    description={t('ce.chartRatesHint')}
                    summary={last ? t('ce.chartRatesSummary', { click: percentFormat(last.click), unsub: percentFormat(last.unsub), bounce: percentFormat(last.bounce) }) : t('chart.noData')}
                    loading={loading}
                    empty={!loading && timeline.length === 0}
                    table={{
                      columns: [
                        { key: 'name', header: t('ce.name'), sortValue: (row) => row.name },
                        { key: 'label', header: t('ce.when') },
                        { key: 'click', header: t('s.clickRate'), numeric: true, render: (row) => percentFormat(row.click), sortValue: (row) => row.click },
                        { key: 'unsub', header: t('s.unsubscribed'), numeric: true, render: (row) => percentFormat(row.unsub), sortValue: (row) => row.unsub },
                        { key: 'bounce', header: t('s.hardBounces'), numeric: true, render: (row) => percentFormat(row.bounce), sortValue: (row) => row.bounce },
                      ],
                      rows: timeline,
                      rowKey: (row) => row.id,
                      exportFile: 'campaign-emails-rates',
                    }}
                  >
                    <LineChart
                      data={timeline}
                      xKey="label"
                      format={percentFormat}
                      series={[
                        { key: 'click', label: t('s.clickRate') },
                        { key: 'unsub', label: t('s.unsubscribed') },
                        { key: 'bounce', label: t('s.hardBounces') },
                      ]}
                      label={t('ce.chartRates')}
                    />
                  </ChartCard>
                </Suspense>
              </div>
              <section className="card" aria-label={t(TAB_KEY[kind])}>
                <DataTable
                  caption={t(TAB_KEY[kind])}
                  captionHidden
                  columns={columns}
                  rows={rows}
                  rowKey={(row) => row.id}
                  loading={sends.isPending}
                  error={sends.isError ? sends.error.message : undefined}
                  initialSort={{ key: 'when', direction: 'descending' }}
                  pageSize={15}
                  totals={
                    rows.length > 1
                      ? { sent: formatNumber(sent), click: percentText(ratio(clicked, sent)), unsub: formatNumber(unsubscribed), bounce: percentText(ratio(hardBounced, sent)) }
                      : undefined
                  }
                  empty={
                    <EmptyState title={t('ce.empty')} icon={<EnvelopeSimple size={28} weight="bold" aria-hidden />}>
                      {t(EMPTY_KEY[kind])}
                    </EmptyState>
                  }
                />
              </section>
            </div>
          </TabPanel>
        </div>
      )}
    </>
  );
}
