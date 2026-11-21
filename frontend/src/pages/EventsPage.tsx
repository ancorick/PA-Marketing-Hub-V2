import { useQuery } from '@tanstack/react-query';
import { listEvents, type EventRow } from '../lib/api';
import { formatAmd, formatDate } from '../lib/format';
import { EVENT_TYPE_LABEL } from '../lib/events';
import { useStaffRole } from '../lib/session';
import { AccessNotice, accessProblem, Alert, DataTable, PageHeader, StatTile, StatusBadge, type Column } from '../ui';
import { CountCell, countCsv, countText, countValue } from './analytics/numbers';
import { PeriodPicker, usePeriod } from './analytics/period';
import { ManualEvents } from './ManualEvents';


const tile = (value: EventRow['leads']) => (value === 'fewer_than_3' ? null : countText(value));

/** Events (PRD 9.6, EVT-05): events as rows of the Events and open days channel. */
export function EventsPage() {
  const role = useStaffRole();
  const [period, setPeriod] = usePeriod();
  const list = useQuery({ queryKey: ['events', role, period], queryFn: () => listEvents(period) });
  const access = accessProblem(list.error);
  const data = list.data;

  const count = (key: 'registrations' | 'attendees' | 'leads' | 'enrolled' | 'hired', header: string, definition: string): Column<EventRow> => ({
    key,
    header,
    numeric: true,
    definition,
    render: (row) => <CountCell value={row[key]} label={key} />,
    sortValue: (row) => countValue(row[key]),
    csv: (row) => countCsv(row[key]),
  });
  const columns: Column<EventRow>[] = [
    {
      key: 'event',
      header: 'Event',
      render: (row) => (
        <div className="stack stack--xs cell-wide">
          <span>{row.title}</span>
          <span className="cluster muted">
            <span className="num">{formatDate(row.startsAt)}</span>· {EVENT_TYPE_LABEL[row.type] ?? row.type}
            {row.source === 'manual' && <StatusBadge tone="neutral">Entered by hand</StatusBadge>}
            {!row.public && <StatusBadge tone="neutral">Not public</StatusBadge>}
          </span>
        </div>
      ),
      sortValue: (row) => row.startsAt,
      csv: (row) => `${row.startsAt.slice(0, 10)} ${row.title}`,
    },
    count('registrations', 'Registrations', 'Registrations not cancelled (a cancelled registration that checked in still counts).'),
    count('attendees', 'Attendees', 'Registrants checked in at the door.'),
    count('leads', 'Leads', 'Registrants who became leads after registering.'),
    count('enrolled', 'Enrolled', 'Registrants who enrolled in a course after registering.'),
    count('hired', 'Hired', 'Registrants hired after registering (Alumni Tracker).'),
    { key: 'cost', header: 'Cost', numeric: true, definition: 'Venue, catering, materials and promotion recorded for the event, in AMD.', render: (row) => formatAmd(row.costAmd), sortValue: (row) => row.costAmd },
  ];

  return (
    <>
      <PageHeader title="Events" description="Open days, workshops and meetups as a channel: who came, who applied and enrolled afterwards, and what each event cost." />
      <PeriodPicker period={period} onChange={setPeriod} />
      {access && (
        <AccessNotice problem={access} title="Sign in to see events">
          Every staff role sees the Events view.
        </AccessNotice>
      )}
      {list.isError && !access && <Alert tone="danger" title="Events not loaded">{list.error.message}</Alert>}
      {data && (
        <div className="stack stack--lg">
          <div className="tiles">
            <StatTile tone="yellow" label="Attendees" value={tile(data.totals.attendees)} definition="Registrants checked in at events in the period." />
            <StatTile label="Leads from events" value={tile(data.totals.leads)} definition="Registrants who became leads after registering." />
            <StatTile label="Enrolled from events" value={tile(data.totals.enrolled)} definition="Registrants who enrolled after registering." />
            <StatTile label="Event cost" value={formatAmd(data.totals.costAmd)} definition="All costs recorded for the events in the period, in AMD." />
          </div>
          <section className="card stack" aria-labelledby="events-heading">
            <h2 id="events-heading">Events in the period</h2>
            <p className="muted">
              Events come from Event Hub; until it is connected they can be entered by hand with attendee lists imported from CSV. The same events form the Events and open days
              channel in Analytics, with each event as a campaign.
            </p>
            <DataTable
              caption="Events in the period"
              captionHidden
              columns={columns}
              rows={data.events}
              rowKey={(row) => row.id}
              initialSort={{ key: 'event', direction: 'descending' }}
              exportFile={`events-${data.period.from}-${data.period.to}`}
              empty="No events in this period."
              footer={
                <tr>
                  <th scope="row">Total</th>
                  <td className="is-num">{countText(data.totals.registrations)}</td>
                  <td className="is-num">{countText(data.totals.attendees)}</td>
                  <td className="is-num">{countText(data.totals.leads)}</td>
                  <td className="is-num">{countText(data.totals.enrolled)}</td>
                  <td className="is-num">{countText(data.totals.hired)}</td>
                  <td className="is-num">{formatAmd(data.totals.costAmd)}</td>
                </tr>
              }
            />
          </section>
          {['editor', 'marketing_manager', 'admin'].includes(role) && <ManualEvents events={data.events} />}
        </div>
      )}
    </>
  );
}
