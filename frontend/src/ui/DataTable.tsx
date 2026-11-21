import { CaretDown, CaretUp, CaretUpDown } from '@phosphor-icons/react';
import { useMemo, useState, type ReactNode } from 'react';
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
};

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
}: DataTableProps<Row>) {
  const [sort, setSort] = useState(initialSort ?? null);

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
    body = sorted.map((row) => (
      <tr key={rowKey(row)}>
        {columns.map((c, index) => {
          const content = c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '');
          const Cell = index === 0 ? 'th' : 'td';
          return (
            <Cell key={c.key} scope={index === 0 ? 'row' : undefined} className={c.numeric ? 'is-num' : undefined}>
              {content}
            </Cell>
          );
        })}
      </tr>
    ));
  }

  return (
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="table" aria-busy={loading || undefined}>
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
                  {c.definition && <Tooltip label={`Definition of ${c.header}`}>{c.definition}</Tooltip>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{body}</tbody>
        {footer && !loading && !error && sorted.length > 0 && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}
