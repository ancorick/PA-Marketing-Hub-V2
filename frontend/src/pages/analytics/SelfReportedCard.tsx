import { useQuery } from '@tanstack/react-query';
import { getSelfReported, type Period, type SelfReported } from '../../lib/api';
import { formatPercent } from '../../lib/format';
import { useStaffRole } from '../../lib/session';
import { DataTable, type Column } from '../../ui';
import { countCsv, countText, countValue } from './numbers';

type Cell = SelfReported['matrix'][number];

/** "How did you hear about us?" against the tracked first touch (PRD 9.4, ANL-16): a check on tracking gaps. */
export function SelfReportedCard({ period }: { period: Period }) {
  const role = useStaffRole();
  const result = useQuery({ queryKey: ['self-reported', role, period], queryFn: () => getSelfReported(period) });
  const data = result.data;
  if (!data) return null;
  const label = (group: string) => (group === 'unmapped' ? 'Unmapped' : (data.groups[group] ?? group));
  const columns: Column<Cell>[] = [
    { key: 'reported', header: 'They said', render: (row) => label(row.reported), sortValue: (row) => label(row.reported) },
    { key: 'tracked', header: 'First tracked touch', render: (row) => label(row.tracked), sortValue: (row) => label(row.tracked) },
    {
      key: 'match',
      header: 'Match',
      render: (row) => (row.reported === row.tracked ? 'Yes' : <span className="muted">No</span>),
      csv: (row) => (row.reported === row.tracked ? 'yes' : 'no'),
    },
    { key: 'count', header: 'Applicants', numeric: true, render: (row) => countText(row.count), sortValue: (row) => countValue(row.count), csv: (row) => countCsv(row.count) },
  ];
  return (
    <section className="card stack no-print" aria-labelledby="self-reported-heading">
      <h2 id="self-reported-heading">Tracking check</h2>
      <p className="muted">
        Applicants in the period whose answer to “How did you hear about us?” matches their first tracked touch, compared by broad group (people rarely know whether a post was an
        ad). A low rate points to tracking gaps, not to a wrong answer.
      </p>
      <dl className="facts">
        <div>
          <dt>Agreement</dt>
          <dd className="num">
            <strong>{data.agreementRate === null ? (data.compared === 0 ? '—' : 'fewer than 3') : formatPercent(data.agreementRate, undefined, { maximumFractionDigits: 0 })}</strong>
            {data.agreementRate !== null && ` of ${countText(data.compared)} compared`}
          </dd>
        </div>
        <div>
          <dt>Answered but not tracked</dt>
          <dd className="num">{countText(data.untracked)}</dd>
        </div>
        <div>
          <dt>No answer / answer not recognised</dt>
          <dd className="num">
            {countText(data.withoutAnswer)} / {countText(data.unrecognisedAnswers)}
          </dd>
        </div>
      </dl>
      <DataTable
        caption="Self-reported source against first tracked touch"
        captionHidden
        columns={columns}
        rows={data.matrix}
        rowKey={(row) => `${row.reported}-${row.tracked}`}
        initialSort={{ key: 'count', direction: 'descending' }}
        empty="No applicants with an answer and a tracked touch in this period."
        exportFile={`tracking-check-${period.from}-${period.to}`}
      />
    </section>
  );
}
