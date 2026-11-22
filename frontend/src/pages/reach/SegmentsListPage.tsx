import { Funnel, Plus } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { listSegments, type Segment } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, ChartCard, DataTable, downloadCsv, EmptyState, PageHeader, retryServerErrors, SkeletonCard, StatTile, tableCsv, Tag, type Column } from '../../ui';
import { BarChart, ExportCsvButton } from '../measure/shared';

/**
 * Segments (PRD 6.4, AUD-13, AUD-14; RESTRUCTURE R4): every segment with its type, last count and update time,
 * the sizes as a chart, and New segment. Dynamic segments recount at send time.
 */
export function SegmentsListPage() {
  const t = useT();
  const role = useStaffRole();
  const segments = useQuery({ queryKey: ['segments', role], queryFn: listSegments, retry: retryServerErrors });
  const access = accessProblem(segments.error);
  const rows = segments.data?.segments ?? [];
  const columns: Column<Segment>[] = [
    {
      key: 'name',
      header: t('seg.segment'),
      render: (row) => (
        <span className="stack stack--xs">
          <a href={`#/segments/${row.id}`}>{row.name}</a>
          {row.description && <span className="muted text-xs text-wrap">{row.description}</span>}
        </span>
      ),
      sortValue: (row) => row.name,
    },
    { key: 'type', header: t('seg.type'), render: (row) => <Tag>{row.type === 'dynamic' ? t('seg.dynamic') : t('seg.static')}</Tag>, sortValue: (row) => row.type },
    {
      key: 'count',
      header: t('seg.contacts'),
      numeric: true,
      definition: t('seg.countDefinition'),
      render: (row) => (row.lastCount === null ? <span className="muted">—</span> : formatNumber(row.lastCount)),
      sortValue: (row) => row.lastCount ?? -1,
      csv: (row) => row.lastCount,
      bar: (row) => row.lastCount,
    },
    { key: 'updated', header: t('seg.updated'), render: (row) => <span className="num nowrap">{formatDate(row.updatedAt, undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>, sortValue: (row) => row.updatedAt },
  ];
  const dynamic = rows.filter((row) => row.type === 'dynamic').length;
  const largest = [...rows].filter((row) => row.lastCount !== null).sort((a, b) => (b.lastCount ?? 0) - (a.lastCount ?? 0));
  const top = largest.slice(0, 12).map((row) => ({ id: row.id, name: row.name, count: row.lastCount ?? 0 }));
  const shared = rows.filter((row) => row.sharedWithEventHub).length;

  return (
    <>
      <PageHeader
        title={t('nav.segments')}
        description={t('seg.description')}
        actions={
          !access && (
            <>
              <ExportCsvButton disabled={rows.length === 0} onExport={() => downloadCsv('segments', tableCsv(columns, rows))} />
              <a className="btn btn--primary" href="#/segments/new">
                <Plus size={18} weight="bold" aria-hidden />
                {t('seg.new')}
              </a>
            </>
          )
        }
      />
      {access ? (
        <AccessNotice problem={access} title={t('seg.access')}>
          {t('seg.accessHint')}
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          <div className="grid-12">
            <div className="span-3">
              <StatTile tone="yellow" label={t('seg.tileSegments')} value={segments.data ? formatNumber(rows.length) : '—'} caption={t('seg.tileSegmentsCaption', { dynamic, static: rows.length - dynamic })} definition={t('seg.tileSegmentsDefinition')} />
            </div>
            <div className="span-3">
              <StatTile label={t('seg.tileLargest')} value={largest[0] ? formatNumber(largest[0].lastCount ?? 0) : '—'} caption={largest[0]?.name} definition={t('seg.countDefinition')} />
            </div>
            <div className="span-3">
              <StatTile label={t('seg.tileEmpty')} value={segments.data ? formatNumber(rows.filter((row) => row.lastCount === 0).length) : '—'} caption={t('seg.tileEmptyCaption')} definition={t('seg.tileEmptyDefinition')} />
            </div>
            <div className="span-3">
              <StatTile label={t('seg.tileShared')} value={segments.data ? formatNumber(shared) : '—'} caption={t('seg.tileSharedCaption')} definition={t('seg.tileSharedDefinition')} />
            </div>
          </div>
          <div className="grid-12">
            <section className="card stack span-8" aria-labelledby="segments-heading">
              <h2 id="segments-heading">{t('seg.all')}</h2>
              <DataTable
                caption={t('nav.segments')}
                captionHidden
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                loading={segments.isPending}
                error={segments.isError ? segments.error.message : undefined}
                initialSort={{ key: 'name', direction: 'ascending' }}
                pageSize={20}
                empty={
                  <EmptyState title={t('seg.empty')} icon={<Funnel size={28} weight="bold" aria-hidden />}>
                    {t('seg.emptyHint')}
                  </EmptyState>
                }
              />
            </section>
            <div className="span-4">
              <Suspense fallback={<SkeletonCard />}>
                <ChartCard
                  title={t('seg.sizes')}
                  description={t('seg.sizesHint')}
                  summary={top[0] ? t('seg.sizesSummary', { name: top[0].name, n: formatNumber(top[0].count) }) : t('chart.noData')}
                  loading={segments.isPending}
                  empty={!segments.isPending && top.length === 0}
                  table={{
                    columns: [
                      { key: 'name', header: t('seg.segment'), sortValue: (row) => row.name },
                      { key: 'count', header: t('seg.contacts'), numeric: true, render: (row) => formatNumber(row.count), sortValue: (row) => row.count },
                    ],
                    rows: top,
                    rowKey: (row) => row.id,
                  }}
                >
                  <BarChart data={top} categoryKey="name" layout="horizontal" series={[{ key: 'count', label: t('seg.contacts') }]} label={t('seg.sizes')} />
                </ChartCard>
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
