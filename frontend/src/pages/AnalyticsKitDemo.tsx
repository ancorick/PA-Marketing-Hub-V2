import { SidebarSimple, Stack } from '@phosphor-icons/react';
import { lazy, Suspense, useState } from 'react';
import { formatAmd, formatNumber } from '../lib/format';
import { presetRange, type DateRange } from '../lib/periods';
import {
  AttributionFilter,
  Button,
  ChartCard,
  DataTable,
  Drawer,
  FilterBar,
  Modal,
  PeriodFilter,
  SkeletonCard,
  StatTile,
  StatusBadge,
  TextField,
  ViewToggle,
  type AttributionModel,
  type Column,
  type Tone,
  type ViewMode,
} from '../ui';

/*
 * RESTRUCTURE R1, item 4: every new component of the analytics kit on stub data (no API calls), so the
 * structure, density and chart types can be judged before the pages are rebuilt in R3–R5.
 */

const Charts = () => import('../charts');
const BarChart = lazy(() => Charts().then((mod) => ({ default: mod.BarChart })));
const LineChart = lazy(() => Charts().then((mod) => ({ default: mod.LineChart })));
const FunnelChart = lazy(() => Charts().then((mod) => ({ default: mod.FunnelChart })));
const DonutChart = lazy(() => Charts().then((mod) => ({ default: mod.DonutChart })));

type ChannelRow = { channel: string; leads: number; enrolled: number; hired: number; spend: number; perEnrolled: number | null };
const CHANNELS: ChannelRow[] = [
  { channel: 'Paid social', leads: 41, enrolled: 6, hired: 2, spend: 1_654_833, perEnrolled: 275_806 },
  { channel: 'Events and open days', leads: 23, enrolled: 3, hired: 2, spend: 838_500, perEnrolled: 279_500 },
  { channel: 'Organic social', leads: 12, enrolled: 3, hired: 0, spend: 552_000, perEnrolled: 184_000 },
  { channel: 'Paid search', leads: 14, enrolled: 2, hired: 1, spend: 832_804, perEnrolled: 416_402 },
  { channel: 'Search and website', leads: 22, enrolled: 1, hired: 0, spend: 981_333, perEnrolled: 981_333 },
  { channel: 'Partners and press', leads: 4, enrolled: 1, hired: 1, spend: 250_000, perEnrolled: 250_000 },
  { channel: 'Chatbot', leads: 11, enrolled: 0, hired: 1, spend: 0, perEnrolled: null },
  { channel: 'Referrals', leads: 1, enrolled: 0, hired: 0, spend: 0, perEnrolled: null },
];

const MONTHS = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
const COHORTS = MONTHS.map((month, i) => ({ month, leads: 26 + ((i * 7) % 19) + i, enrolled: 5 + ((i * 3) % 4), hired: i < 6 ? 1 + (i % 3) : 0 }));
const NEW_CONTACTS = MONTHS.map((month, i) => ({ month, contacts: 70 + ((i * 13) % 27) }));
const LANGUAGES = [
  { label: 'Armenian', value: 1123 },
  { label: 'English', value: 372 },
  { label: 'Russian', value: 284 },
];
const FUNNEL = [
  { label: 'Leads', value: 128 },
  { label: 'Applied', value: 43 },
  { label: 'Enrolled', value: 16 },
  { label: 'Completed', value: 11 },
  { label: 'Hired', value: 7 },
];

type ContactRow = { id: string; name: string; type: string; consent: 'granted' | 'unknown' | 'withdrawn'; status: 'active' | 'unsubscribed' | 'bounced' };
const FIRST = ['Ani', 'Aram', 'Lilit', 'Gor', 'Mane', 'Narek', 'Sona', 'Tigran', 'Elen', 'Davit', 'Meri', 'Hayk'];
const LAST = ['Sample', 'Example', 'Demo', 'Test'];
const CONTACTS: ContactRow[] = Array.from({ length: 23 }, (_, i) => ({
  id: `c${i}`,
  name: `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`,
  type: ['subscriber', 'lead', 'student', 'alumnus'][i % 4] as string,
  consent: (['granted', 'granted', 'unknown', 'withdrawn'] as const)[i % 4] as ContactRow['consent'],
  status: (['active', 'active', 'active', 'unsubscribed', 'bounced'] as const)[i % 5] as ContactRow['status'],
}));
const CONSENT: Record<ContactRow['consent'], Tone> = { granted: 'success', unknown: 'neutral', withdrawn: 'danger' };
const STATUS: Record<ContactRow['status'], Tone> = { active: 'success', unsubscribed: 'warning', bounced: 'danger' };

const amd = (value: number | null) => (value === null ? '—' : formatAmd(value));

export function AnalyticsKitDemo() {
  const [period, setPeriod] = useState<DateRange>(() => presetRange('last_quarter'));
  const [model, setModel] = useState<AttributionModel>('first_touch');
  const [view, setView] = useState<ViewMode>('period');
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);

  const channelColumns: Column<ChannelRow>[] = [
    { key: 'channel', header: 'Channel', sortValue: (row) => row.channel },
    { key: 'leads', header: 'Leads', numeric: true, sortValue: (row) => row.leads },
    { key: 'enrolled', header: 'Enrolled', numeric: true, sortValue: (row) => row.enrolled },
    { key: 'hired', header: 'Hired', numeric: true, sortValue: (row) => row.hired },
    { key: 'spend', header: 'Spend', numeric: true, render: (row) => (row.spend ? formatAmd(row.spend) : <span className="muted">no spend</span>), sortValue: (row) => row.spend },
    {
      key: 'perEnrolled',
      header: 'Cost per enrolled student',
      numeric: true,
      definition: 'Channel spend divided by enrolled students credited to the channel.',
      render: (row) => (row.perEnrolled === null ? <span className="muted">—</span> : formatAmd(row.perEnrolled)),
      sortValue: (row) => row.perEnrolled ?? -1,
      csv: (row) => row.perEnrolled,
      bar: (row) => row.perEnrolled,
    },
  ];
  const totals = CHANNELS.reduce((sum, row) => ({ leads: sum.leads + row.leads, enrolled: sum.enrolled + row.enrolled, hired: sum.hired + row.hired, spend: sum.spend + row.spend }), {
    leads: 0,
    enrolled: 0,
    hired: 0,
    spend: 0,
  });
  const contactColumns: Column<ContactRow>[] = [
    { key: 'name', header: 'Name', sortValue: (row) => row.name },
    { key: 'type', header: 'Type', render: (row) => <StatusBadge tone="neutral">{row.type}</StatusBadge>, sortValue: (row) => row.type },
    { key: 'consent', header: 'Newsletter consent', render: (row) => <StatusBadge tone={CONSENT[row.consent]}>{row.consent}</StatusBadge>, sortValue: (row) => row.consent },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge tone={STATUS[row.status]}>{row.status}</StatusBadge>, sortValue: (row) => row.status },
  ];

  return (
    <div className="stack stack--lg">
      <p className="muted">
        New in the restructure (RESTRUCTURE R1): filter panel, metric tiles with captions and trend lines, tables with inline bars, a Total row and pages, chart
        cards with a Table view, the chart kit, modal and drawer. Stub data only.
      </p>

      <FilterBar label="Filters (example)">
        <PeriodFilter value={period} onChange={setPeriod} />
        <AttributionFilter value={model} onChange={setModel} />
        <ViewToggle value={view} onChange={setView} />
      </FilterBar>

      <div className="grid-12">
        <div className="span-3">
          <StatTile tone="yellow" label="Newsletter subscribers" value={formatNumber(1055)} caption="Active, with newsletter consent" definition="Contacts whose latest newsletter consent is granted and who can be emailed." spark={[880, 905, 930, 962, 990, 1010, 1031, 1055]} />
        </div>
        <div className="span-3">
          <StatTile label="Newsletter click rate" value="6.1%" caption="Opens 42% (estimated) · last 3 issues" definition="Unique clickers divided by delivered newsletter emails." delta={0.08} spark={[4.8, 5.2, 5.1, 5.6, 5.9, 6.1]} />
        </div>
        <div className="span-3">
          <StatTile label="New leads" value="128" caption={`${period.from} – ${period.to}`} definition="People who first expressed interest in a course in the period." delta={-0.04} spark={[30, 41, 38, 44, 36, 42]} />
        </div>
        <div className="span-3">
          <StatTile label="Enrolled from them" value="17" caption="So far; later enrollments still count" definition="Of the new leads, those who have since enrolled." delta={0.13} />
        </div>
      </div>

      <section className="card stack" aria-labelledby="kit-outcomes">
        <div>
          <h2 id="kit-outcomes">Outcomes and cost by channel</h2>
          <p className="muted">Inline bars on the key metric and a Total row built from the columns.</p>
        </div>
        <DataTable
          caption="Outcomes and cost by channel (example)"
          captionHidden
          columns={channelColumns}
          rows={CHANNELS}
          rowKey={(row) => row.channel}
          initialSort={{ key: 'leads', direction: 'descending' }}
          totals={{ channel: 'All channels', leads: formatNumber(totals.leads), enrolled: formatNumber(totals.enrolled), hired: formatNumber(totals.hired), spend: formatAmd(totals.spend), perEnrolled: formatAmd(Math.round(totals.spend / totals.enrolled)) }}
          exportFile="example-channels"
        />
      </section>

      <Suspense fallback={<SkeletonCard />}>
        <div className="grid-12">
          <ChartCard
            className="span-6"
            title="Enrolled students by channel"
            description="Horizontal bars for rankings"
            summary="Paid social brought the most enrolled students (6), then events and organic social (3 each)."
            table={{ columns: channelColumns.slice(0, 3), rows: CHANNELS, rowKey: (row) => row.channel }}
          >
            <BarChart data={CHANNELS} categoryKey="channel" series={[{ key: 'enrolled', label: 'Enrolled' }]} layout="horizontal" label="Enrolled students by channel" />
          </ChartCard>
          <ChartCard
            className="span-6"
            title="New contacts per month"
            description="Columns for counts over time"
            summary="Between 70 and 96 new contacts a month over the last year."
            table={{
              columns: [
                { key: 'month', header: 'Month' },
                { key: 'contacts', header: 'New contacts', numeric: true, sortValue: (row: (typeof NEW_CONTACTS)[number]) => row.contacts },
              ],
              rows: NEW_CONTACTS,
              rowKey: (row) => row.month,
            }}
          >
            <BarChart data={NEW_CONTACTS} categoryKey="month" series={[{ key: 'contacts', label: 'New contacts', color: 'var(--chart-2)' }]} label="New contacts per month" />
          </ChartCard>
          <ChartCard
            className="span-8"
            title="Leads, enrolled and hired by cohort month"
            definition="People grouped by the month of first touch; younger cohorts are still maturing."
            summary="Leads stay between 26 and 55 a month; hires appear only in cohorts older than six months."
            table={{
              columns: [
                { key: 'month', header: 'Cohort' },
                { key: 'leads', header: 'Leads', numeric: true },
                { key: 'enrolled', header: 'Enrolled', numeric: true },
                { key: 'hired', header: 'Hired', numeric: true },
              ],
              rows: COHORTS,
              rowKey: (row) => row.month,
            }}
          >
            <LineChart
              data={COHORTS}
              xKey="month"
              series={[
                { key: 'leads', label: 'Leads' },
                { key: 'enrolled', label: 'Enrolled' },
                { key: 'hired', label: 'Hired' },
              ]}
              label="Leads, enrolled and hired by cohort month"
            />
          </ChartCard>
          <ChartCard className="span-4" title="By language" summary="Two thirds of contacts read in Armenian.">
            <DonutChart data={LANGUAGES} label="Contacts by language" centerLabel={formatNumber(1779)} />
          </ChartCard>
          <ChartCard className="span-6" title="From lead to hired" summary="128 leads became 7 hired graduates; the biggest drop is from lead to application.">
            <FunnelChart stages={FUNNEL} label="Funnel from lead to hired" />
          </ChartCard>
          <div className="span-6 stack">
            <ChartCard title="Loading" summary="" loading height={140}>
              {null}
            </ChartCard>
            <ChartCard title="No data yet" summary="" empty>
              {null}
            </ChartCard>
          </div>
        </div>
      </Suspense>

      <section className="card stack" aria-labelledby="kit-contacts">
        <div>
          <h2 id="kit-contacts">Status badges and pages</h2>
          <p className="muted">Badges carry text, not only colour; long lists are split into pages.</p>
        </div>
        <DataTable caption="Contacts (example)" captionHidden columns={contactColumns} rows={CONTACTS} rowKey={(row) => row.id} pageSize={8} />
      </section>

      <section className="card stack" aria-labelledby="kit-dialogs">
        <h2 id="kit-dialogs">Modal and drawer</h2>
        <div className="cluster">
          <Button variant="secondary" icon={<Stack size={18} aria-hidden />} onClick={() => setModal(true)}>
            Open modal
          </Button>
          <Button variant="secondary" icon={<SidebarSimple size={18} aria-hidden />} onClick={() => setDrawer(true)}>
            Open drawer
          </Button>
        </div>
      </section>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="New segment"
        description="A modal for short, focused tasks."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setModal(false)}>
              Create segment
            </Button>
          </>
        }
      >
        <TextField label="Segment name" placeholder="Alumni, hired in 2026" />
      </Modal>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Ani Sample" description="A drawer keeps the list in view: contact card, manual event.">
        <dl className="facts">
          <div>
            <dt>Type</dt>
            <dd>Lead</dd>
          </div>
          <div>
            <dt>First touch</dt>
            <dd>Paid social · 2 Nov 2026</dd>
          </div>
          <div>
            <dt>Spend credited</dt>
            <dd className="num">{amd(40_362)}</dd>
          </div>
        </dl>
      </Drawer>
    </div>
  );
}
