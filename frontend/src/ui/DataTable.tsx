import { CaretDown, CaretLeft, CaretRight, CaretUp, CaretUpDown, DownloadSimple } from '@phosphor-icons/react';
import { useMemo, useState, type ReactNode } from 'react';
import { csvFile } from '../lib/csv';
import { useT } from '../lib/i18n';
import { Button } from './Button';
import { Tooltip } from './Tooltip';

export type Column<Row> = {
  key: string;
  header: string;
  /** Numeric columns are right-aligned with tabular figures. */
  numeric?: boolean;
  /** Cell content; defaults to String(row[key]). */
  render?: (row: Row) => ReactNode;
  /** Value used for sorting; a column without it is not sortable. */
  sortValue?: (row: Row) => number | string;
  /** Metric definition, shown in a tooltip next to the header (ANL-15). */
  definition?: string;
  /** Value written to the CSV export; defaults to sortValue; columns with neither are left out. */
  csv?: (row: Row) => string | number | null;
  /** Inline bar next to the value, scaled to the largest row (RESTRUCTURE §4: key metric at a glance). */
  bar?: (row: Row) => number | null;
};

/** CSV of the rows as sorted (ANL-12): columns with a csv value (or a sort value); others are left out. */
export function tableCsv<Row>(columns: Column<Row>[], rows: Row[]): string {
  const exported = columns.filter((c) => c.csv || c.sortValue);
  return csvFile(
    exported.map((c) => c.header),
    rows.map((row) => exported.map((c) => (c.csv ?? c.sortValue)!(row))),
  );
}

/** Saves text as a CSV file in the browser (page-level Export CSV buttons use it too). */
export function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name.endsWith('.csv') ? name : `${name}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type DataTableProps<Row> = {
  caption: string;
  /** Hide the caption visually but keep it for screen readers (when a card heading already names the table). */
  captionHidden?: boolean;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  error?: ReactNode;
  /** Shown when there are no rows: say what is empty and what to do next (PRD 13.7). */
  empty?: ReactNode;
  footer?: ReactNode;
  initialSort?: { key: string; direction: 'ascending' | 'descending' };
  /** File name for "Download CSV" (ANL-12); no button without it. */
  exportFile?: string;
  /** Total row built from the columns: cell content per column key; the first column says "Total". */
  totals?: Partial<Record<string, ReactNode>>;
  /** Long lists are shown page by page; CSV still exports every row. */
  pageSize?: number;
  /** Tighter cell padding for wide numeric tables (cohorts). */
  dense?: boolean;
};

/** Accessible data table: real <table>, sortable headers with aria-sort, scroll wrapper on narrow screens. */
export function DataTable<Row>({
  caption,
  captionHidden = false,
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  empty = 'No rows yet.',
  footer,
  initialSort,
  exportFile,
  totals,
  pageSize,
  dense = false,
}: DataTableProps<Row>) {
  const t = useT();
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const column = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !column?.sortValue) return rows;
    const getValue = column.sortValue;
    const factor = sort.direction === 'ascending' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb)) * factor;
    });
  }, [rows, columns, sort]);

  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const currentPage = Math.min(page, pages - 1);
  const visible = pageSize ? sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : sorted;
  // Bars are scaled to the largest value of the whole list, so pages stay comparable.
  const barMax = useMemo(() => {
    const max: Record<string, number> = {};
    for (const c of columns) if (c.bar) max[c.key] = Math.max(0, ...rows.map((row) => c.bar!(row) ?? 0));
    return max;
  }, [rows, columns]);

  const toggleSort = (key: string, numeric: boolean) => {
    setSort((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' };
      }
      // Numbers usually read best largest-first.
      return { key, direction: numeric ? 'descending' : 'ascending' };
    });
  };

  let body: ReactNode;
  if (loading) {
    body = Array.from({ length: 4 }, (_, i) => (
      <tr key={`loading-${i}`} aria-hidden>
        {columns.map((c) => (
          <td key={c.key}>
            <span className="skeleton" style={{ height: '0.75rem', width: c.numeric ? '3rem' : '70%', marginLeft: c.numeric ? 'auto' : 0 }} />
          </td>
        ))}
      </tr>
    ));
  } else if (error) {
    body = (
      <tr>
        <td className="table__state" colSpan={columns.length}>
          {error}
        </td>
      </tr>
    );
  } else if (sorted.length === 0) {
    body = (
      <tr>
        <td className="table__state" colSpan={columns.length}>
          {empty}
        </td>
      </tr>
    );
  } else {
    body = visible.map((row) => (
      <tr key={rowKey(row)}>
        {columns.map((c, index) => {
          const content = c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '');
          const Cell = index === 0 ? 'th' : 'td';
          const value = c.bar?.(row);
          const max = barMax[c.key] ?? 0;
          return (
            <Cell key={c.key} scope={index === 0 ? 'row' : undefined} className={c.numeric ? 'is-num' : undefined}>
              {c.bar ? (
                <span className="inline-bar">
                  <span className="inline-bar__value">{content}</span>
                  <span className="inline-bar__track" aria-hidden>
                    <span className="inline-bar__fill" style={{ width: `${value && max > 0 ? Math.max((value / max) * 100, 2) : 0}%` }} />
                  </span>
                </span>
              ) : (
                content
              )}
            </Cell>
          );
        })}
      </tr>
    ));
  }

  const table = (
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className={dense ? 'table table--dense' : 'table'} aria-busy={loading || undefined}>
        <caption className={captionHidden ? 'visually-hidden' : undefined}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const SortIcon = !active ? CaretUpDown : sort.direction === 'ascending' ? CaretUp : CaretDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={c.numeric ? 'is-num' : undefined}
                  aria-sort={active ? sort.direction : c.sortValue ? 'none' : undefined}
                >
                  {c.sortValue ? (
                    <button type="button" className="sort-btn" onClick={() => toggleSort(c.key, Boolean(c.numeric))}>
                      {c.header}
                      <SortIcon size={12} weight="bold" aria-hidden />
                    </button>
                  ) : (
                    c.header
                  )}
                  {c.definition && <Tooltip label={t('tip.definitionOf', { name: typeof c.header === 'string' ? c.header : c.key })}>{c.definition}</Tooltip>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{body}</tbody>
        {!loading && !error && sorted.length > 0 && (footer || totals) && (
          <tfoot>
            {footer ?? (
              <tr>
                {columns.map((c, index) =>
                  index === 0 ? (
                    <th key={c.key} scope="row">
                      {totals?.[c.key] ?? t('table.total')}
                    </th>
                  ) : (
                    <td key={c.key} className={c.numeric ? 'is-num' : undefined}>
                      {totals?.[c.key] ?? ''}
                    </td>
                  ),
                )}
              </tr>
            )}
          </tfoot>
        )}
      </table>
    </div>
  );
  const pager = pageSize && sorted.length > pageSize && (
    <nav className="pager" aria-label={caption}>
      <span className="muted num" role="status">
        {t('table.range', { from: currentPage * pageSize + 1, to: Math.min((currentPage + 1) * pageSize, sorted.length), total: sorted.length })}
      </span>
      <Button size="sm" variant="ghost" iconOnly aria-label={t('table.previous')} icon={<CaretLeft size={16} weight="bold" aria-hidden />} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} />
      <Button size="sm" variant="ghost" iconOnly aria-label={t('table.next')} icon={<CaretRight size={16} weight="bold" aria-hidden />} disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)} />
    </nav>
  );
  if (!exportFile && !pager) return table;
  if (!exportFile)
    return (
      <div className="stack stack--sm">
        {table}
        {pager}
      </div>
    );
  return (
    <div className="stack stack--sm">
      <div className="table-tools no-print">
        <Button size="sm" variant="ghost" icon={<DownloadSimple size={16} aria-hidden />} disabled={loading || sorted.length === 0} onClick={() => downloadCsv(exportFile, tableCsv(columns, sorted))}>
          {t('table.download')}<span className="visually-hidden">: {caption}</span>
        </Button>
      </div>
      {table}
      {pager}
    </div>
  );
}
