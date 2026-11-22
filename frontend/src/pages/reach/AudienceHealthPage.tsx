import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { getAudienceHealth, getProgramMetrics, type AudienceHealth, type Count } from '../../lib/api';
import { formatNumber, formatPercent } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, ChartCard, DataTable, PageHeader, SkeletonCard, SkeletonTile, StatTile, type Column } from '../../ui';
import { countText } from '../analytics/numbers';
import { BarChart, chartCount, chartCountFormat, DonutChart, LineChart, PrintButton, useMonthLabel } from '../measure/shared';
import { useContactLabels } from './ContactsPage';

const MetricsSection = lazy(() => import('../analytics/MetricsSection').then((mod) => ({ default: mod.MetricsSection })));

/**
 * Audience health (PRD 3.2 M3/M4, 6, 13.6; RESTRUCTURE R4): size and consent coverage, growth and people leaving
 * the list per month, lifecycle and language mix, the largest segments and the success metrics.
 */
export function AudienceHealthPage() {
  const t = useT();
  const role = useStaffRole();
  const health = useQuery({ queryKey: ['audience-health', role], queryFn: getAudienceHealth });
  const metrics = useQuery({ queryKey: ['program-metrics', role], queryFn: getProgramMetrics });
  const access = accessProblem(health.error);
  const data = health.data;
  const metric = (id: string) => metrics.data?.metrics.find((item) => item.id === id);
  const m3 = metric('M3');
  const m4 = metric('M4');
  const tile = (value: Count | undefined) => (value === undefined ? '—' : value === 'fewer_than_3' ? null : formatNumber(value));

  return (
    <>
      <PageHeader title={t('nav.audienceHealth')} description={t('ah.description')} actions={<PrintButton disabled={!data} />} />
      {access ? (
        <AccessNotice problem={access} title={t('ah.access')}>
          {t('ah.accessHint')}
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          {health.isError && <Alert tone="danger" title={t('m.notLoaded')}>{health.error.message}</Alert>}
          <div className="grid-12">
            {health.isPending ? (
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="span-3">
                  <SkeletonTile />
                </div>
              ))
            ) : (
              <>
                <div className="span-3">
                  <StatTile
                    tone="yellow"
                    label={t('ah.contacts')}
                    value={tile(data?.total)}
                    caption={data ? t('ah.contactsCaption', { n: countText(data.newPerMonth.at(-1)?.count ?? 0) }) : undefined}
                    definition={t('ah.contactsDefinition')}
                    spark={data && !data.shared ? data.newPerMonth.map((row) => chartCount(row.count)) : undefined}
                  />
                </div>
                <div className="span-3">
                  <StatTile
                    label={t('ah.consentRecorded')}
                    value={data?.consentRecordedRate == null ? '—' : formatPercent(data.consentRecordedRate, undefined, { maximumFractionDigits: 0 })}
                    caption={data ? t('ah.consentCaption', { granted: countText(data.consent.granted), unknown: countText(data.consent.unknown) }) : undefined}
                    definition={t('ah.consentDefinition')}
                  />
                </div>
                <div className="span-3">
                  <StatTile label={t('ah.m4')} value={m4?.value ?? '—'} caption={m4 ? `${m4.detail} · ${t('ah.target', { target: m4.target })}` : undefined} definition={m4?.source ?? t('ah.m4')} />
                </div>
                <div className="span-3">
                  <StatTile label={t('ah.m3')} value={m3?.value ?? '—'} caption={m3 ? `${m3.detail} · ${t('ah.target', { target: m3.target })}` : undefined} definition={m3?.source ?? t('ah.m3')} />
                </div>
              </>
            )}
          </div>
          {data && (
            <Suspense fallback={<SkeletonCard />}>
              <HealthCharts data={data} />
            </Suspense>
          )}
          <Suspense fallback={<SkeletonCard />}>
            <MetricsSection />
          </Suspense>
        </div>
      )}
    </>
  );
}

type Leaving = { month: string; label: string; unsubscribed: number; bounced: number; complaints: number };

function HealthCharts({ data }: { data: AudienceHealth }) {
  const t = useT();
  const label = useContactLabels();
  const monthLabel = useMonthLabel();
  const format = chartCountFormat(data.shared);
  const growth = data.newPerMonth.map((row) => ({ month: row.month, label: monthLabel(row.month), count: chartCount(row.count) }));
  const leaving: Leaving[] = data.leavingPerMonth.map((row) => ({ month: row.month, label: monthLabel(row.month), unsubscribed: chartCount(row.unsubscribed), bounced: chartCount(row.bounced), complaints: chartCount(row.complaints) }));
  const peak = growth.reduce<(typeof growth)[number] | null>((best, row) => (!best || row.count > best.count ? row : best), null);
  const left = leaving.reduce((sum, row) => sum + row.unsubscribed + row.bounced + row.complaints, 0);
  const types = data.byType.map((row) => ({ label: label.type(row.key), value: chartCount(row.count) }));
  const languages = data.byLanguage.map((row) => ({ label: label.language(row.key), value: chartCount(row.count) }));
  const totalNumber = typeof data.total === 'number' ? data.total : 0;
  const share = (value: number) => (totalNumber > 0 ? formatPercent(value / totalNumber, undefined, { maximumFractionDigits: 0 }) : '—');
  const segmentColumns: Column<AudienceHealth['largestSegments'][number]>[] = [
    { key: 'name', header: t('seg.segment'), render: (row) => <a href={`#/segments/${row.id}`}>{row.name}</a>, sortValue: (row) => row.name },
    { key: 'count', header: t('seg.contacts'), numeric: true, render: (row) => countText(row.count), sortValue: (row) => chartCount(row.count), bar: (row) => chartCount(row.count) },
  ];

  return (
    <>
      <div className="grid-12">
        <ChartCard
          className="span-6"
          title={t('ah.newPerMonth')}
          description={t('ah.newPerMonthHint')}
          summary={peak && peak.count > 0 ? t('ah.newSummary', { month: peak.label, n: format(peak.count) }) : t('chart.noData')}
          empty={growth.every((row) => row.count === 0)}
          table={{
            columns: [
              { key: 'label', header: t('m.month') },
              { key: 'count', header: t('ah.newContacts'), numeric: true, render: (row) => format(row.count), sortValue: (row) => row.count },
            ],
            rows: growth,
            rowKey: (row) => row.month,
            exportFile: 'new-contacts-per-month',
          }}
        >
          <BarChart data={growth} categoryKey="label" format={format} series={[{ key: 'count', label: t('ah.newContacts') }]} label={t('ah.newPerMonth')} />
        </ChartCard>
        <ChartCard
          className="span-6"
          title={t('ah.leaving')}
          description={t('ah.leavingHint')}
          summary={left > 0 ? t('ah.leavingSummary', { n: format(left) }) : t('ah.leavingNone')}
          table={{
            columns: [
              { key: 'label', header: t('m.month') },
              { key: 'unsubscribed', header: t('ah.unsubscribed'), numeric: true, render: (row) => format(row.unsubscribed) },
              { key: 'bounced', header: t('ah.bounced'), numeric: true, render: (row) => format(row.bounced) },
              { key: 'complaints', header: t('ah.complaints'), numeric: true, render: (row) => format(row.complaints) },
            ],
            rows: leaving,
            rowKey: (row) => row.month,
            exportFile: 'leaving-the-list-per-month',
          }}
        >
          <LineChart
            data={leaving}
            xKey="label"
            format={format}
            series={[
              { key: 'unsubscribed', label: t('ah.unsubscribed') },
              { key: 'bounced', label: t('ah.bounced') },
              { key: 'complaints', label: t('ah.complaints') },
            ]}
            label={t('ah.leaving')}
          />
        </ChartCard>
      </div>
      <div className="grid-12">
        <ChartCard
          className="span-4"
          title={t('ah.byType')}
          summary={types[0] ? t('ah.byTypeSummary', { type: types[0].label, share: share(types[0].value) }) : t('chart.noData')}
          empty={types.length === 0}
          table={{
            columns: [
              { key: 'label', header: t('r.type') },
              { key: 'value', header: t('seg.contacts'), numeric: true, render: (row) => format(row.value), sortValue: (row) => row.value },
            ],
            rows: types,
            rowKey: (row) => row.label,
          }}
        >
          <DonutChart data={types} format={format} label={t('ah.byType')} centerLabel={countText(data.total)} />
        </ChartCard>
        <ChartCard
          className="span-4"
          title={t('ah.byLanguage')}
          summary={languages[0] ? t('ah.byLanguageSummary', { language: languages[0].label, share: share(languages[0].value) }) : t('chart.noData')}
          empty={languages.length === 0}
          table={{
            columns: [
              { key: 'label', header: t('r.language') },
              { key: 'value', header: t('seg.contacts'), numeric: true, render: (row) => format(row.value), sortValue: (row) => row.value },
            ],
            rows: languages,
            rowKey: (row) => row.label,
          }}
        >
          <DonutChart data={languages} format={format} label={t('ah.byLanguage')} centerLabel={countText(data.total)} />
        </ChartCard>
        <section className="card stack span-4" aria-labelledby="largest-heading">
          <div>
            <h2 id="largest-heading">{t('ah.largestSegments')}</h2>
            <p className="muted">{t('ah.largestHint')}</p>
          </div>
          <DataTable caption={t('ah.largestSegments')} captionHidden columns={segmentColumns} rows={data.largestSegments} rowKey={(row) => row.id} empty={t('seg.empty')} />
        </section>
      </div>
    </>
  );
}
