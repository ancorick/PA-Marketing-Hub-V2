import { useId, useState, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { DataTable, type Column } from './DataTable';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { Tooltip } from './Tooltip';

/**
 * Card around every chart (RESTRUCTURE §4): title, optional definition (i), a Chart / Table switch with the same
 * data as a table, and a one-sentence summary for screen readers and print. Loading shows a skeleton of the
 * chart's height, no data shows an empty state instead of an empty axis frame.
 */
export function ChartCard<Row>({
  title,
  description,
  definition,
  summary,
  table,
  actions,
  loading = false,
  empty = false,
  height = 280,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Metric definition behind the chart (ANL-15). */
  definition?: string;
  /** One sentence with the key insight; read by screen readers, shown under the chart. */
  summary: string;
  /** The same data as a table for the Table view. */
  table?: { columns: Column<Row>[]; rows: Row[]; rowKey: (row: Row) => string; exportFile?: string };
  actions?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const headingId = useId();
  return (
    <section className={['card', 'chart-card', className].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      <div className="chart-card__header">
        <div className="chart-card__title">
          <h2 id={headingId}>
            {title}
            {definition && <Tooltip label={`${title}: definition`}>{definition}</Tooltip>}
          </h2>
          {description && <p className="muted">{description}</p>}
        </div>
        <div className="cluster cluster--nowrap">
          {actions}
          {table && (
            <div className="segmented segmented--compact" role="group" aria-label={`${t('chart.show')}: ${title}`}>
              <button type="button" className="segmented__btn" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
                {t('chart.chart')}
              </button>
              <button type="button" className="segmented__btn" aria-pressed={view === 'table'} onClick={() => setView('table')}>
                {t('chart.table')}
              </button>
            </div>
          )}
        </div>
      </div>
      {loading ? (
        <Skeleton height={`${height}px`} />
      ) : empty ? (
        <EmptyState title={t('chart.noData')} />
      ) : view === 'table' && table ? (
        <DataTable caption={title} captionHidden columns={table.columns} rows={table.rows} rowKey={table.rowKey} exportFile={table.exportFile} />
      ) : (
        <figure className="chart-card__figure">
          {children}
          <figcaption className="chart-card__summary">{summary}</figcaption>
        </figure>
      )}
    </section>
  );
}
