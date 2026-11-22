import {
  ArrowsClockwise,
  CalendarBlank,
  Copy,
  DotsThree,
  DownloadSimple,
  EnvelopeSimple,
  Newspaper,
  PaperPlaneTilt,
  PauseCircle,
  PencilSimple,
  Plus,
  ShieldCheck,
  SquaresFour,
  Trash,
  UsersThree,
} from '@phosphor-icons/react';
import { AnimatePresence, m } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { formatAmd, formatNumber, formatPercent, SMALL_NUMBER_TEXT, suppressSmall } from '../lib/format';
import { duration, ease } from '../lib/motion';
import { SimpleBarChart, SimpleLineChart } from '../charts';
import { AnalyticsKitDemo } from './AnalyticsKitDemo';
import { Disclosure, Menu, Reveal, Stagger, StaggerItem, Tilt, useMotionPreference } from '../motion';
import {
  Alert,
  BrandBadge,
  Button,
  Chip,
  ConfirmDialog,
  DataTable,
  EmptyState,
  HighlightCard,
  PageHeader,
  SearchField,
  SectionTitle,
  SelectField,
  SkeletonCard,
  SkeletonTile,
  StatTile,
  StatusBadge,
  Tag,
  TextField,
  type Column,
} from '../ui';

/*
 * Living preview of design-system/marketing-hub/MASTER.md (Picsart Academy brand concept).
 * All numbers here are SAMPLE data for visual review, not Academy data.
 */

const BRAND_SWATCHES = [
  { name: 'Yellow', token: '--brand-yellow', use: 'Primary action, active nav, counters' },
  { name: 'Aqua', token: '--brand-aqua', use: 'Selection, toggles, info' },
  { name: 'Magenta', token: '--brand-magenta', use: 'Highlight cards (white text)' },
  { name: 'Ink', token: '--brand-ink', use: 'Text on brand fills' },
] as const;

const SURFACE_SWATCHES = ['bg', 'surface', 'surface-raised', 'surface-chip', 'border', 'border-strong', 'text', 'text-muted', 'text-subtle'] as const;
const STATUS_SWATCHES = ['success', 'warning', 'danger', 'link'] as const;

const RADII = [
  { token: '--radius-sm', label: '8 · tags' },
  { token: '--radius-md', label: '12 · inputs' },
  { token: '--radius-lg', label: '18 · tables' },
  { token: '--radius-xl', label: '24 · cards' },
  { token: '--radius-pill', label: 'pill · buttons' },
] as const;

const MOTION_TOKENS = [
  { token: '--duration-instant', value: '100ms', use: 'press, small color changes' },
  { token: '--duration-fast', value: '150ms', use: 'hover: buttons, chips, nav, table rows' },
  { token: '--duration-base', value: '200ms', use: 'card lift, menus, tooltips, page change' },
  { token: '--duration-moderate', value: '250ms', use: 'dialogs, disclosure' },
  { token: '--duration-slow', value: '400ms', use: 'reveal of sections' },
  { token: '--duration-counter', value: '900ms', use: 'count-up, chart grow' },
  { token: '--stagger-step', value: '40ms', use: 'delay between siblings' },
  { token: '--ease-enter / -exit', value: 'decelerate / accelerate', use: 'arriving / leaving; exit ≈ 70% of enter' },
] as const;

const CHART_SERIES = [
  { token: '--chart-1', dash: undefined, name: 'Paid social' },
  { token: '--chart-2', dash: '6 4', name: 'Search' },
  { token: '--chart-3', dash: '2 3', name: 'Email' },
  { token: '--chart-4', dash: '8 3 2 3', name: 'Events' },
  { token: '--chart-5', dash: '12 4', name: 'Referral' },
  { token: '--chart-6', dash: undefined, name: 'Other' },
] as const;

const FILTERS = [
  { key: 'all', label: 'All', count: 24, icon: SquaresFour },
  { key: 'campaigns', label: 'Campaigns', count: 8, icon: PaperPlaneTilt },
  { key: 'newsletters', label: 'Newsletters', count: 6, icon: Newspaper },
  { key: 'segments', label: 'Segments', count: 7, icon: UsersThree },
  { key: 'events', label: 'Events', count: 3, icon: CalendarBlank },
] as const;

const LEADS_BY_MONTH = [
  { label: 'Dec', value: 182 },
  { label: 'Jan', value: 214 },
  { label: 'Feb', value: 196 },
  { label: 'Mar', value: 248 },
  { label: 'Apr', value: 231 },
  { label: 'May', value: 205 },
  { label: 'Jun', value: 168 },
  { label: 'Jul', value: 187 },
  { label: 'Aug', value: 226 },
  { label: 'Sep', value: 289 },
  { label: 'Oct', value: 302 },
  { label: 'Nov', value: 334 },
];

const SUBSCRIBERS_BY_MONTH = [
  { label: 'Dec', value: 9120 },
  { label: 'Jan', value: 9340 },
  { label: 'Feb', value: 9610 },
  { label: 'Mar', value: 9880 },
  { label: 'Apr', value: 10120 },
  { label: 'May', value: 10290 },
  { label: 'Jun', value: 10410 },
  { label: 'Jul', value: 10760 },
  { label: 'Aug', value: 11190 },
  { label: 'Sep', value: 11620 },
  { label: 'Oct', value: 12068 },
  { label: 'Nov', value: 12480 },
];

type ChannelRow = { channel: string; leads: number; enrolled: number; hired: number; cost: number };

const SAMPLE_CHANNELS: ChannelRow[] = [
  { channel: 'Paid social', leads: 1240, enrolled: 86, hired: 21, cost: 4_850_000 },
  { channel: 'Search', leads: 610, enrolled: 54, hired: 14, cost: 2_100_000 },
  { channel: 'Email', leads: 420, enrolled: 39, hired: 11, cost: 180_000 },
  { channel: 'Events', leads: 315, enrolled: 27, hired: 2, cost: 1_350_000 },
  { channel: 'Referral', leads: 98, enrolled: 12, hired: 1, cost: 0 },
];

const costPerStudent = (row: ChannelRow) => (row.enrolled > 0 ? row.cost / row.enrolled : 0);

const CHANNEL_COLUMNS: Column<ChannelRow>[] = [
  { key: 'channel', header: 'Channel', sortValue: (r) => r.channel },
  { key: 'leads', header: 'Leads', numeric: true, sortValue: (r) => r.leads, render: (r) => formatNumber(r.leads) },
  { key: 'enrolled', header: 'Enrolled', numeric: true, sortValue: (r) => r.enrolled, render: (r) => formatNumber(r.enrolled) },
  {
    key: 'hired',
    header: 'Hired',
    numeric: true,
    sortValue: (r) => r.hired,
    render: (r) => suppressSmall(r.hired) ?? <span className="muted">{SMALL_NUMBER_TEXT}</span>,
  },
  {
    key: 'cps',
    header: 'Cost per student',
    numeric: true,
    sortValue: costPerStudent,
    render: (r) => (r.cost === 0 ? <span className="muted">no cost</span> : formatAmd(costPerStudent(r))),
  },
];

const countInt = (n: number) => formatNumber(Math.round(n));
const countPercent = (n: number) => formatPercent(n, undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  return (
    <Reveal>
      <section aria-labelledby={id} className="stack">
        <SectionTitle id={id} title={title} count={count} />
        {children}
      </section>
    </Reveal>
  );
}

export function DesignSystemPage() {
  const { reduced, override, setOverride } = useMotionPreference();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [tableState, setTableState] = useState<'data' | 'loading' | 'empty' | 'error'>('data');
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [email, setEmail] = useState('ani@exmaple');
  const emailError = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? undefined : 'Enter an email address like name@example.am.';

  const totals = SAMPLE_CHANNELS.reduce(
    (acc, r) => ({ leads: acc.leads + r.leads, enrolled: acc.enrolled + r.enrolled, hired: acc.hired + r.hired, cost: acc.cost + r.cost }),
    { leads: 0, enrolled: 0, hired: 0, cost: 0 },
  );

  const simulateLoading = () => {
    setLoadingDemo(true);
    window.setTimeout(() => setLoadingDemo(false), 1800);
  };

  return (
    <>
      <PageHeader
        title="Marketing Hub"
        accent="Design system"
        description="Picsart Academy brand: dark surfaces, yellow, aqua and magenta, big radii, pill controls and purposeful motion. Switch the theme and language at the bottom of the sidebar."
        actions={
          <Chip
            selected={reduced}
            onClick={() => setOverride(override === null ? !reduced : null)}
            title={override === null ? 'Following your system setting' : 'Preview override; click again to follow the system'}
          >
            Reduce motion{override === null ? ' (system)' : ' (preview)'}
          </Chip>
        }
      />
      <div className="stack stack--lg">
        <Reveal>
          <Alert tone="info" title="Sample data">
            Every number on this page is made up for visual review. It is not Academy data.
          </Alert>
        </Reveal>

        {/* Highlight cards: tilt + spotlight under the cursor, lift + brand glow on hover */}
        <Stagger className="grid grid--3">
          <StaggerItem>
            <HighlightCard
              tone="magenta"
              badge={<BrandBadge icon={<Newspaper size={14} weight="bold" aria-hidden />}>Newsletter</BrandBadge>}
              title="March issue in 6 days"
              description="Draft ready: 9 blocks, 2 marked AI-drafted"
              href="#/newsletter"
            />
          </StaggerItem>
          <StaggerItem>
            <HighlightCard
              tone="aqua"
              badge={<BrandBadge icon={<UsersThree size={14} weight="bold" aria-hidden />}>Audience</BrandBadge>}
              title="12,480 subscribers"
              description="+412 this month, consent recorded for 98%"
              href="#/contacts"
            />
          </StaggerItem>
          <StaggerItem>
            <HighlightCard
              tone="yellow"
              badge={<BrandBadge icon={<ShieldCheck size={14} weight="bold" aria-hidden />}>Email health</BrandBadge>}
              title="Domain verified"
              description="SPF, DKIM and DMARC pass; warm-up day 9 of 21"
              href="#/email-settings"
            />
          </StaggerItem>
        </Stagger>

        {/* Main search: animated rainbow border */}
        <Reveal>
          <div className="filter-panel">
            <SearchField label="Search contacts, campaigns and issues" placeholder="Search contacts, campaigns and issues" />
            <div className="cluster" role="group" aria-label="Filter by type">
              {FILTERS.map(({ key, label, count, icon: ItemIcon }) => (
                <Chip key={key} selected={filter === key} count={count} icon={<ItemIcon size={16} weight="bold" aria-hidden />} onClick={() => setFilter(key)}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>
        </Reveal>

        <Section id="ds-analytics" title="Analytics kit">
          <AnalyticsKitDemo />
        </Section>

        <Section id="ds-tiles" title="Headline tiles">
          <div className="cluster">
            <Button variant="secondary" size="sm" icon={<ArrowsClockwise size={14} weight="bold" aria-hidden />} onClick={simulateLoading} disabled={loadingDemo}>
              Simulate loading
            </Button>
            <span className="muted" role="status" aria-live="polite">
              {loadingDemo ? 'Loading tiles and cards…' : ''}
            </span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {loadingDemo ? (
              <m.div key="skeleton" className="tiles" exit={{ opacity: 0, transition: { duration: duration.fast } }}>
                <SkeletonTile />
                <SkeletonTile />
                <SkeletonTile />
                <SkeletonTile />
              </m.div>
            ) : (
              <m.div
                key="tiles"
                className="tiles"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: duration.base, ease: ease.enter } }}
              >
                <StatTile
                  tone="yellow"
                  label="Subscribers"
                  value={formatNumber(12480)}
                  countTo={{ value: 12480, format: countInt }}
                  delta={0.034}
                  definition="Contacts with active marketing consent on the last day of the range."
                  href="#/contacts"
                />
                <StatTile
                  label="Newsletter click rate"
                  value={formatPercent(0.062)}
                  countTo={{ value: 0.062, format: countPercent }}
                  delta={-0.008}
                  definition="Unique clickers divided by delivered, last issue in range. Opens are estimated and not used."
                  href="#/newsletter"
                />
                <StatTile
                  label="New leads"
                  value={formatNumber(2683)}
                  countTo={{ value: 2683, format: countInt }}
                  delta={0}
                  definition="People whose first touch falls in the range. Model: first touch."
                  href="#/campaigns-links"
                />
                <StatTile label="Hired from Referral" value={suppressSmall(1)} definition="Shown as 'fewer than 3' in shared views to protect individuals." />
              </m.div>
            )}
          </AnimatePresence>
        </Section>

        <Section id="ds-charts" title="Charts">
          <div className="grid grid--2">
            <div className="card">
              <div className="card__header">
                <h3>New leads per month</h3>
                <StatusBadge tone="success">+10.6% vs October</StatusBadge>
              </div>
              <SimpleBarChart
                data={LEADS_BY_MONTH}
                unit="Leads"
                summary="Leads grew for three months in a row and reached 334 in November, the highest in the year."
              />
            </div>
            <div className="card">
              <div className="card__header">
                <h3>Subscribers</h3>
                <StatusBadge tone="info">12-month trend</StatusBadge>
              </div>
              <SimpleLineChart
                data={SUBSCRIBERS_BY_MONTH}
                unit="Subscribers"
                summary="Subscribers rose steadily from 9,120 to 12,480 over 12 months, faster since August."
              />
            </div>
          </div>
        </Section>

        <Section id="ds-cards" title="Cards" count={3}>
          {loadingDemo ? (
            <div className="grid grid--3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : (
            <Stagger className="grid grid--3">
              <StaggerItem>
                <Tilt as="article" tilt={false} className="card card--yellow card--interactive">
                  <div className="cluster spread">
                    <BrandBadge icon={<Newspaper size={14} weight="bold" aria-hidden />}>Issue</BrandBadge>
                    <span className="eyebrow">In review</span>
                  </div>
                  <div className="item-card__head">
                    <span className="icon-tile" aria-hidden>
                      <Newspaper size={22} weight="bold" />
                    </span>
                    <div className="stack stack--xs">
                      <span className="eyebrow">Monthly · Armenian, English</span>
                      <h3 className="item-card__title">March newsletter</h3>
                    </div>
                  </div>
                  <p>New courses, two open events and three alumni stories, collected automatically.</p>
                  <div className="cluster">
                    <Tag>#courses</Tag>
                    <Tag>#events</Tag>
                    <Tag>#alumni</Tag>
                  </div>
                  <div className="inset">
                    <div className="cluster spread">
                      <strong>Approval</strong>
                      <BrandBadge>1/2 approved</BrandBadge>
                    </div>
                    <span>Waiting for the marketing manager · send on 2026-12-01</span>
                    <div>
                      <Button variant="primary" size="sm" icon={<PaperPlaneTilt size={14} weight="bold" aria-hidden />}>
                        Send test
                      </Button>
                    </div>
                  </div>
                  <div className="item-card__foot">Edited by Mariam Hakobyan</div>
                </Tilt>
              </StaggerItem>

              <StaggerItem>
                <Tilt as="article" tilt={false} className="card card--interactive">
                  <div className="cluster spread">
                    <BrandBadge icon={<PaperPlaneTilt size={14} weight="bold" aria-hidden />}>Campaign</BrandBadge>
                    <StatusBadge tone="success">Sent</StatusBadge>
                  </div>
                  <div className="item-card__head">
                    <span className="icon-tile" aria-hidden>
                      <EnvelopeSimple size={22} weight="bold" />
                    </span>
                    <div className="stack stack--xs">
                      <span className="eyebrow">Recruitment · Graphic design</span>
                      <h3 className="item-card__title">Spring intake: last week to apply</h3>
                    </div>
                  </div>
                  <div className="item-card__meta">
                    <span>
                      <UsersThree size={16} aria-hidden /> 4,912 contacts
                    </span>
                    <span>
                      <CalendarBlank size={16} aria-hidden /> 2026-11-14
                    </span>
                  </div>
                  <div className="inset">
                    <div className="cluster spread">
                      <span>Unique clicks</span>
                      <strong className="num">{formatPercent(0.071)}</strong>
                    </div>
                    <div className="cluster spread">
                      <span>Applications</span>
                      <strong className="num">{formatNumber(38)}</strong>
                    </div>
                  </div>
                  <div className="item-card__foot">Sent by Davit Sargsyan</div>
                </Tilt>
              </StaggerItem>

              <StaggerItem>
                <Tilt as="article" tilt={false} className="card card--interactive">
                  <div className="cluster spread">
                    <BrandBadge icon={<UsersThree size={14} weight="bold" aria-hidden />}>Segment</BrandBadge>
                    <Menu
                      label="Segment actions"
                      trigger={
                        <>
                          <DotsThree size={18} weight="bold" aria-hidden />
                          <span className="visually-hidden">Segment actions</span>
                        </>
                      }
                      items={[
                        { label: 'Edit rules', icon: <PencilSimple size={16} aria-hidden />, onSelect: () => setLastAction('Edit rules') },
                        { label: 'Duplicate', icon: <Copy size={16} aria-hidden />, onSelect: () => setLastAction('Duplicate') },
                        { label: 'Export CSV', icon: <DownloadSimple size={16} aria-hidden />, onSelect: () => setLastAction('Export CSV') },
                        { label: 'Delete segment', icon: <Trash size={16} aria-hidden />, danger: true, separatorBefore: true, onSelect: () => setLastAction('Delete segment') },
                      ]}
                    />
                  </div>
                  <div className="item-card__head">
                    <span className="icon-tile" aria-hidden>
                      <UsersThree size={22} weight="bold" />
                    </span>
                    <div className="stack stack--xs">
                      <span className="eyebrow">Audience · Rules</span>
                      <h3 className="item-card__title">Armenian speakers interested in design</h3>
                    </div>
                  </div>
                  <div className="cluster">
                    <Tag>language = hy</Tag>
                    <Tag>interest = design</Tag>
                    <Tag>consent = yes</Tag>
                  </div>
                  <div className="inset">
                    <div className="cluster spread">
                      <span>Contacts now</span>
                      <strong className="num">{formatNumber(1874)}</strong>
                    </div>
                    <span className="muted">Recalculated at send time; suppressed contacts excluded.</span>
                  </div>
                  <div className="item-card__foot" role="status" aria-live="polite">
                    {lastAction ? `Chosen: ${lastAction} (preview only)` : 'Owner: Ani Petrosyan'}
                  </div>
                </Tilt>
              </StaggerItem>
            </Stagger>
          )}
        </Section>

        <Section id="ds-table" title="Data table">
          <div className="cluster" role="group" aria-label="Preview table state">
            {(['data', 'loading', 'empty', 'error'] as const).map((state) => (
              <Chip key={state} selected={tableState === state} onClick={() => setTableState(state)}>
                {state}
              </Chip>
            ))}
          </div>
          <DataTable
            caption="Channels · last 90 days · first-touch model"
            columns={CHANNEL_COLUMNS}
            rows={tableState === 'empty' ? [] : SAMPLE_CHANNELS}
            rowKey={(r) => r.channel}
            loading={tableState === 'loading'}
            error={
              tableState === 'error' ? (
                <Alert tone="danger" title="Could not load channels" action={<Button size="sm">Try again</Button>}>
                  The analytics service did not answer.
                </Alert>
              ) : undefined
            }
            empty={
              <EmptyState title="No channel data yet" action={<a href="#/campaigns-links">Open Data health</a>}>
                Connect an ad account on the Data health page, then wait for the nightly pull.
              </EmptyState>
            }
            initialSort={{ key: 'leads', direction: 'descending' }}
            footer={
              <tr>
                <th scope="row">Total</th>
                <td className="is-num">{formatNumber(totals.leads)}</td>
                <td className="is-num">{formatNumber(totals.enrolled)}</td>
                <td className="is-num">{formatNumber(totals.hired)}</td>
                <td className="is-num">{formatAmd(totals.cost / totals.enrolled)}</td>
              </tr>
            }
          />
        </Section>

        <Section id="ds-buttons" title="Buttons, menus and badges">
          <div className="card">
            <div className="cluster">
              <Button variant="primary" icon={<PaperPlaneTilt size={16} weight="bold" aria-hidden />}>
                Send test
              </Button>
              <Button variant="secondary" icon={<DownloadSimple size={16} weight="bold" aria-hidden />}>
                Export CSV
              </Button>
              <Button variant="ghost" icon={<Plus size={16} weight="bold" aria-hidden />}>
                Add rule
              </Button>
              <Button variant="danger" icon={<PauseCircle size={16} weight="bold" aria-hidden />} onClick={() => setDialogOpen(true)}>
                {paused ? 'Resume sending' : 'Pause all sending'}
              </Button>
              <Button variant="primary" loading>
                Saving
              </Button>
              <Button variant="secondary" disabled>
                Disabled
              </Button>
              <Menu
                label="Export options"
                trigger={
                  <>
                    <DownloadSimple size={16} weight="bold" aria-hidden /> Export
                  </>
                }
                items={[
                  { label: 'Table as CSV', onSelect: () => setLastAction('Table as CSV') },
                  { label: 'Overview as PDF', onSelect: () => setLastAction('Overview as PDF') },
                  { label: 'Copy link to view', onSelect: () => setLastAction('Copy link to view') },
                ]}
              />
            </div>
            <div className="cluster">
              <BrandBadge>Category</BrandBadge>
              <StatusBadge tone="success">DKIM verified</StatusBadge>
              <StatusBadge tone="warning">Maturing cohort</StatusBadge>
              <StatusBadge tone="danger">DMARC failing</StatusBadge>
              <StatusBadge tone="info">AI-drafted</StatusBadge>
              <StatusBadge tone="neutral">Draft</StatusBadge>
              {paused && <StatusBadge tone="danger">Sending paused</StatusBadge>}
              <Tag>#tag</Tag>
            </div>
          </div>
        </Section>

        <Section id="ds-form" title="Form fields and disclosure">
          <div className="card">
            <div className="form-row">
              <TextField label="Contact email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={emailError} />
              <SelectField
                label="Preferred language"
                hint="Used for newsletters and confirmations."
                options={[
                  { value: 'hy', label: 'Հայերեն (Armenian)' },
                  { value: 'en', label: 'English' },
                  { value: 'ru', label: 'Русский (Russian)' },
                ]}
              />
              <TextField label="Contact ID" readOnly value="c_01JD7K2M9Q" hint="Read-only: assigned by the Core Engine." />
            </div>
            <Disclosure title="Advanced filters">
              <div className="form-row">
                <SelectField
                  label="Source"
                  options={[
                    { value: 'any', label: 'Any source' },
                    { value: 'form', label: 'Website form' },
                    { value: 'event', label: 'Event' },
                    { value: 'import', label: 'Import' },
                  ]}
                />
                <SelectField
                  label="Consent"
                  options={[
                    { value: 'yes', label: 'Given' },
                    { value: 'pending', label: 'Pending double opt-in' },
                    { value: 'no', label: 'Withdrawn' },
                  ]}
                />
              </div>
            </Disclosure>
          </div>
        </Section>

        <Section id="ds-alerts" title="Alerts and empty state">
          <div className="grid grid--2">
            <div className="stack">
              <Alert tone="warning" title="Sending domain is warming up">
                Daily cap today: 500 emails. It rises automatically over the next 3 weeks.
              </Alert>
              <Alert tone="success" title="Import finished">
                1,180 contacts added, 42 merged as duplicates.
              </Alert>
              <Alert tone="danger" title="Ad account disconnected" action={<a href="#/campaigns-links">Reconnect in Data health</a>}>
                Meta Ads has not answered since 2026-11-18.
              </Alert>
            </div>
            <div className="card">
              <EmptyState title="No segments yet" action={<Button variant="primary">Create segment</Button>}>
                Segments pick contacts by rules, for example language is Armenian and interest is design.
              </EmptyState>
            </div>
          </div>
        </Section>

        <Section id="ds-motion" title="Motion">
          <div className="grid grid--2">
            <div className="card">
              <h3>Where motion is used, and where it is not</h3>
              <p>
                Motion here explains a change: what you can click (hover lift), where something came from (menus grow from their button,
                dialogs rise), and how a number got there (count-up, growing bars). Effects that only decorate (tilt, spotlight, rainbow)
                stay on a few large brand elements.
              </p>
              <p>
                Tables, forms and long lists stay still apart from color on hover: people read and compare data there, and rows can number
                in the thousands, so nothing staggers, counts or tilts inside them. With reduced motion everything becomes instant and
                loops stop.
              </p>
              <div className="cluster">
                <StatusBadge tone={reduced ? 'warning' : 'success'}>{reduced ? 'Reduced motion is on' : 'Full motion'}</StatusBadge>
              </div>
            </div>
            <div className="card">
              <h3>Tokens</h3>
              <div className="table-wrap">
                <table className="table">
                  <caption className="visually-hidden">Motion tokens</caption>
                  <thead>
                    <tr>
                      <th scope="col">Token</th>
                      <th scope="col">Value</th>
                      <th scope="col">Use</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MOTION_TOKENS.map((t) => (
                      <tr key={t.token}>
                        <th scope="row">
                          <code>{t.token}</code>
                        </th>
                        <td>{t.value}</td>
                        <td>{t.use}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Section>

        <Section id="ds-foundations" title="Foundations">
          <div className="grid grid--2">
            <div className="card">
              <h3>Brand colors</h3>
              <ul className="swatches list-reset">
                {BRAND_SWATCHES.map((s) => (
                  <li key={s.token} className="swatch">
                    <span className="swatch__chip" style={{ background: `var(${s.token})` }} aria-hidden />
                    <strong>{s.name}</strong>
                    <span className="muted">{s.use}</span>
                  </li>
                ))}
              </ul>
              <h3>Surfaces, text and status</h3>
              <ul className="swatches list-reset">
                {[...SURFACE_SWATCHES, ...STATUS_SWATCHES].map((token) => (
                  <li key={token} className="swatch">
                    <span className="swatch__chip" style={{ background: `var(--color-${token})` }} aria-hidden />
                    <code>--color-{token}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <h3>Typography: Manrope + Noto Sans Armenian</h3>
              <p className="text-gradient" style={{ fontSize: 'var(--text-display)', fontWeight: 800, lineHeight: 1.1 }}>
                Գրադարան
              </p>
              <p className="num" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, lineHeight: 1.1 }}>
                {formatNumber(12480)} · {formatAmd(56395)}
              </p>
              <p style={{ fontSize: 'var(--text-xl)', fontWeight: 800 }}>Section title, 28 heavy</p>
              <p style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Card title, 20 bold</p>
              <p>Body, 16 medium. Marketing Hub keeps one deduplicated contact base.</p>
              <p lang="hy">Բաժանորդներ, նորությունների թերթ, միջոցառումներ։ Հայերեն տեքստը պետք է ճիշտ ցուցադրվի։</p>
              <p lang="ru">Подписчики, рассылка, мероприятия. Русский текст тоже должен отображаться корректно.</p>
              <span className="eyebrow">Eyebrow label · 11 bold uppercase</span>
              <h3>Radius</h3>
              <div className="cluster cluster--md">
                {RADII.map((r) => (
                  <span key={r.token} className="radius-demo" style={{ borderRadius: `var(${r.token})` }}>
                    {r.label}
                  </span>
                ))}
              </div>
              <h3>Chart series: color plus line style</h3>
              <ul className="legend">
                {CHART_SERIES.map((s) => (
                  <li key={s.token}>
                    <svg width="32" height="10" aria-hidden>
                      <line x1="0" y1="5" x2="32" y2="5" stroke={`var(${s.token})`} strokeWidth="3" strokeDasharray={s.dash} />
                    </svg>
                    {s.name}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        open={dialogOpen}
        title={paused ? 'Resume all sending?' : 'Pause all sending?'}
        affected={{ count: 4912, noun: 'contacts in 3 scheduled sends' }}
        confirmLabel={paused ? 'Resume sending' : 'Pause all sending'}
        tone={paused ? 'primary' : 'danger'}
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => {
          setPaused((p) => !p);
          setDialogOpen(false);
        }}
      >
        {paused
          ? 'Scheduled campaigns and newsletters will start sending again at their planned times.'
          : 'Every campaign, newsletter and test send stops immediately. Nothing is lost: sends wait until you resume.'}
      </ConfirmDialog>
    </>
  );
}
