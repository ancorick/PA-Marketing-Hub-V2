import { useQuery } from '@tanstack/react-query';
import { getSelfReported, type Period, type SelfReported } from '../../lib/api';
import { formatPercent } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import { DataTable, type Column } from '../../ui';
import { countCsv, countText, countValue } from './numbers';

type Cell = SelfReported['matrix'][number];

/** "How did you hear about us?" against the tracked first touch (PRD 9.4, ANL-16): a check on tracking gaps. */
export function SelfReportedCard({ period }: { period: Period }) {
  const t = useT();
  const role = useStaffRole();
  const result = useQuery({ queryKey: ['self-reported', role, period], queryFn: () => getSelfReported(period) });
  const data = result.data;
  if (!data) return null;
  const label = (group: string) => (group === 'unmapped' ? t('lg.sr.unmapped') : (data.groups[group] ?? group));
  const columns: Column<Cell>[] = [
    { key: 'reported', header: t('lg.sr.said'), render: (row) => label(row.reported), sortValue: (row) => label(row.reported) },
    { key: 'tracked', header: t('lg.sr.tracked'), render: (row) => label(row.tracked), sortValue: (row) => label(row.tracked) },
    {
      key: 'match',
      header: t('lg.sr.match'),
      render: (row) => (row.reported === row.tracked ? t('lg.sr.yes') : <span className="muted">{t('lg.sr.no')}</span>),
      csv: (row) => (row.reported === row.tracked ? 'yes' : 'no'),
    },
    { key: 'count', header: t('lg.sr.applicants'), numeric: true, render: (row) => countText(row.count), sortValue: (row) => countValue(row.count), csv: (row) => countCsv(row.count) },
  ];
  return (
    <section className="card stack no-print" aria-labelledby="self-reported-heading">
      <h2 id="self-reported-heading">{t('lg.sr.title')}</h2>
      <p className="muted">{t('lg.sr.intro')}</p>
      <dl className="facts">
        <div>
          <dt>{t('lg.sr.agreement')}</dt>
          <dd className="num">
            <strong>{data.agreementRate === null ? (data.compared === 0 ? '—' : t('lg.fewerThan3')) : formatPercent(data.agreementRate, undefined, { maximumFractionDigits: 0 })}</strong>
            {data.agreementRate !== null && ` ${t('lg.sr.ofCompared', { n: countText(data.compared) })}`}
          </dd>
        </div>
        <div>
          <dt>{t('lg.sr.untracked')}</dt>
          <dd className="num">{countText(data.untracked)}</dd>
        </div>
        <div>
          <dt>{t('lg.sr.noAnswer')}</dt>
          <dd className="num">
            {countText(data.withoutAnswer)} / {countText(data.unrecognisedAnswers)}
          </dd>
        </div>
      </dl>
      <DataTable
        caption={t('lg.sr.caption')}
        captionHidden
        columns={columns}
        rows={data.matrix}
        rowKey={(row) => `${row.reported}-${row.tracked}`}
        initialSort={{ key: 'count', direction: 'descending' }}
        empty={t('lg.sr.empty')}
        exportFile={`tracking-check-${period.from}-${period.to}`}
      />
    </section>
  );
}
