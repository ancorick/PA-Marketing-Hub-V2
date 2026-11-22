import { CurrencyCircleDollar, FileArrowUp, PencilSimple, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import {
  ApiError,
  createCost,
  deleteCost,
  getOverview,
  getRates,
  listAnalyticsChannels,
  listCampaignRegistry,
  listCostEntries,
  listCosts,
  saveRate,
  updateCost,
  uploadAdSpendCsv,
  type Channel,
  type CostEntry,
  type CostSource,
  type CostTrend,
} from '../../lib/api';
import { formatAmd, formatNumber, formatPercent } from '../../lib/format';
import { useT, type StringKey } from '../../lib/i18n';
import { yerevanToday } from '../../lib/periods';
import { useStaffRole } from '../../lib/session';
import {
  AccessNotice,
  accessProblem,
  Alert,
  Button,
  ChartCard,
  ConfirmDialog,
  DataTable,
  downloadCsv,
  FilterBar,
  PageHeader,
  PeriodFilter,
  SelectField,
  SkeletonCard,
  StatTile,
  StatusBadge,
  tableCsv,
  Tag,
  TextField,
  type Column,
} from '../../ui';
import { usePeriod } from '../analytics/period';
import { amd, BarChart, channelName, DonutChart, ExportCsvButton, numberOf, useBucketLabel, useDayLabel } from './shared';

type SourceFilter = 'all' | 'ads' | 'manual' | 'event_hub' | 'csv';
const SOURCE_FILTERS: { id: SourceFilter; label: StringKey; match: (source: CostSource) => boolean }[] = [
  { id: 'all', label: 'cost.all', match: () => true },
  { id: 'ads', label: 'cost.adApis', match: (source) => source === 'api' },
  { id: 'manual', label: 'cost.manual', match: (source) => source === 'manual' },
  { id: 'event_hub', label: 'cost.eventHub', match: (source) => source === 'event_hub' },
  { id: 'csv', label: 'cost.csv', match: (source) => source === 'csv' },
];
const SOURCE_LABEL: Record<CostSource, StringKey> = { api: 'cost.adApi', csv: 'cost.csv', manual: 'cost.manual', event_hub: 'cost.eventHub' };
const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const blank = () => ({ channel: '', campaign: '', description: '', dateFrom: yerevanToday(), dateTo: yerevanToday(), amount: '', currency: 'AMD' });

/**
 * Costs (PRD 9.1, 9.2, 9.5, ANL-05; RESTRUCTURE R3): spend tiles and charts for the period, manual cost entry,
 * exchange rates, the ad report CSV fallback and every cost entry with its source.
 */
export function CostsPage() {
  const t = useT();
  const role = useStaffRole();
  const canEdit = role === 'admin' || role === 'marketing_manager';
  const queryClient = useQueryClient();
  const [period, setPeriod] = usePeriod();
  const costs = useQuery({ queryKey: ['costs', role, period], queryFn: () => listCosts(period) });
  const entries = useQuery({ queryKey: ['cost-entries', role, period], queryFn: () => listCostEntries(period) });
  const outcomes = useQuery({ queryKey: ['overview', role, period, 'first_touch', 'period'], queryFn: () => getOverview(period, 'first_touch', 'period') });
  const channels = useQuery({ queryKey: ['analytics-channels', role], queryFn: listAnalyticsChannels, staleTime: Infinity });
  const [source, setSource] = useState<SourceFilter>('all');
  const [editing, setEditing] = useState<CostEntry | null>(null);
  const [form, setForm] = useState(blank);
  const [deleting, setDeleting] = useState<CostEntry | null>(null);
  const dayLabel = useDayLabel();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['costs'] });
    void queryClient.invalidateQueries({ queryKey: ['cost-entries'] });
    void queryClient.invalidateQueries({ queryKey: ['overview'] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => deleteCost(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const name = (id: string | null) => channelName(id, channels.data?.channels);

  const access = accessProblem(costs.error);
  const summary = costs.data?.channels ?? [];
  const total = summary.reduce((sum, row) => sum + row.totalAmd, 0);
  const adSpend = summary.reduce((sum, row) => sum + row.adSpendAmd, 0);
  const totals = outcomes.data?.totals;
  const list = entries.data?.entries ?? [];
  const filter = SOURCE_FILTERS.find((item) => item.id === source)!;
  const visible = list.filter((entry) => filter.match(entry.source));
  const dates = (entry: CostEntry) => (entry.dateFrom === entry.dateTo ? dayLabel(entry.dateFrom, true) : `${dayLabel(entry.dateFrom)} – ${dayLabel(entry.dateTo, true)}`);

  const startEdit = (entry: CostEntry) => {
    setEditing(entry);
    setForm({ channel: entry.channel, campaign: entry.campaign ?? '', description: entry.note, dateFrom: entry.dateFrom, dateTo: entry.dateTo, amount: entry.originalAmount, currency: entry.currency });
    document.getElementById('cost-form-heading')?.scrollIntoView({ block: 'start' });
  };

  const columns: Column<CostEntry>[] = [
    { key: 'dates', header: t('cost.dates'), render: (row) => <span className="nowrap num">{dates(row)}</span>, sortValue: (row) => row.dateFrom, csv: (row) => (row.dateFrom === row.dateTo ? row.dateFrom : `${row.dateFrom} – ${row.dateTo}`) },
    { key: 'channel', header: t('m.channel'), render: (row) => <span className="nowrap">{name(row.channel)}</span>, sortValue: (row) => name(row.channel) },
    {
      key: 'campaign',
      header: t('m.campaign'),
      render: (row) => (row.campaignName ? row.campaignName : row.campaign ? <code>{row.campaign}</code> : <span className="muted">{t('cost.wholeChannel')}</span>),
      sortValue: (row) => row.campaignName ?? row.campaign ?? '',
    },
    { key: 'amount', header: t('cost.amountAmd'), numeric: true, render: (row) => formatAmd(row.amountAmd), sortValue: (row) => row.amountAmd },
    {
      key: 'original',
      header: t('cost.original'),
      numeric: true,
      render: (row) =>
        row.currency === 'AMD' ? (
          ''
        ) : (
          <span className="muted nowrap">
            {formatNumber(Number(row.originalAmount), undefined, { minimumFractionDigits: 2 })} {row.currency} @ {formatNumber(row.rateToAmd, undefined, { maximumFractionDigits: 2 })}
          </span>
        ),
      csv: (row) => (row.currency === 'AMD' ? '' : `${row.originalAmount} ${row.currency} @ ${row.rateToAmd}`),
    },
    { key: 'source', header: t('cost.source'), render: (row) => <Tag>{t(SOURCE_LABEL[row.source])}</Tag>, sortValue: (row) => row.source },
    { key: 'note', header: t('cost.note'), render: (row) => <span className="text-wrap">{row.note}</span>, csv: (row) => row.note },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: t('m.actions'),
            render: (row: CostEntry) =>
              row.manualId ? (
                <div className="cluster cluster--nowrap">
                  <Button size="sm" variant="ghost" icon={<PencilSimple size={16} aria-hidden />} onClick={() => startEdit(row)}>
                    {t('m.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" iconOnly aria-label={`${t('m.delete')}: ${row.note}`} icon={<Trash size={16} aria-hidden />} onClick={() => setDeleting(row)} />
                </div>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('nav.costs')}
        description={t('cost.description')}
        actions={<ExportCsvButton disabled={visible.length === 0} onExport={() => downloadCsv(`costs-${source}-${period.from}-${period.to}`, tableCsv(columns, visible))} />}
      />
      <FilterBar label={t('m.filters')}>
        <PeriodFilter value={period} onChange={setPeriod} />
      </FilterBar>
      {access ? (
        <AccessNotice problem={access} title="Costs are for signed-in staff">
          Sign in to see channel costs.
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          {costs.isError && <Alert tone="danger" title={t('m.notLoaded')}>{costs.error.message}</Alert>}
          <div className="grid-12">
            <div className="span-3">
              <StatTile
                tone="yellow"
                label={t('cost.total')}
                value={costs.data ? formatAmd(total) : '—'}
                caption={costs.data ? t('cost.totalCaption', { ads: formatAmd(adSpend), other: formatAmd(total - adSpend) }) : undefined}
                definition={t('cost.totalDefinition')}
              />
            </div>
            <div className="span-3">
              <StatTile
                label={t('m.costPerLead')}
                value={totals ? amd(totals.costPerLead) : '—'}
                caption={totals && numberOf(totals.lead) !== null ? t('cost.leadsCaption', { n: formatNumber(numberOf(totals.lead)!) }) : undefined}
                definition={t('cost.perLeadDefinition')}
              />
            </div>
            <div className="span-3">
              <StatTile
                label={t('m.costPerEnrolledStudent')}
                value={totals ? amd(totals.costPerEnrolled) : '—'}
                caption={totals && numberOf(totals.enrolled) !== null ? t('cost.enrolledCaption', { n: formatNumber(numberOf(totals.enrolled)!) }) : undefined}
                definition={t('cost.perEnrolledDefinition')}
              />
            </div>
            <div className="span-3">
              <StatTile
                label={t('cost.adShare')}
                value={costs.data ? (total > 0 ? formatPercent(adSpend / total) : '—') : '—'}
                caption={t('cost.adShareCaption', { n: formatNumber(list.length) })}
                definition={t('cost.adShareDefinition')}
              />
            </div>
          </div>

          <Suspense fallback={<SkeletonCard />}>
            <SpendCharts trend={costs.data?.trend} summary={summary} channels={channels.data?.channels} loading={costs.isPending} period={period} />
          </Suspense>

          <div className="grid-12">
            {canEdit && (
              <CostForm
                className="span-6"
                form={form}
                setForm={setForm}
                editing={editing}
                onDone={() => {
                  setEditing(null);
                  setForm(blank());
                  refresh();
                }}
                onCancel={() => {
                  setEditing(null);
                  setForm(blank());
                }}
                channels={channels.data?.channels ?? []}
                currencies={costs.data?.currencies ?? ['AMD']}
              />
            )}
            <div className={`${canEdit ? 'span-6' : 'span-12'} stack stack--lg`}>
              <RatesCard canEdit={canEdit} />
              {canEdit && <AdCsvCard onImported={refresh} />}
            </div>
          </div>

          <section className="card stack" aria-labelledby="cost-entries-heading">
            <div className="card__header">
              <div>
                <h2 id="cost-entries-heading">{t('cost.entries')}</h2>
                <p className="muted">{t('cost.entriesHint')}</p>
              </div>
              <div className="segmented segmented--compact" role="group" aria-label={t('cost.source')}>
                {SOURCE_FILTERS.map((item) => (
                  <button key={item.id} type="button" className="segmented__btn nowrap" aria-pressed={source === item.id} onClick={() => setSource(item.id)}>
                    <span>
                      {t(item.label)} · <span className="num">{list.filter((entry) => item.match(entry.source)).length}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <DataTable
              caption={t('cost.entries')}
              captionHidden
              columns={columns}
              rows={visible}
              rowKey={(row) => `${row.source}-${row.id}`}
              loading={entries.isPending}
              pageSize={25}
              initialSort={{ key: 'dates', direction: 'descending' }}
              totals={{ dates: t('table.total'), amount: formatAmd(visible.reduce((sum, row) => sum + row.amountAmd, 0)) }}
              empty={canEdit ? t('cost.emptyEdit') : t('cost.empty')}
            />
          </section>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('cost.deleteTitle')}
        confirmLabel={t('cost.deleteConfirm')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting?.manualId && remove.mutate(deleting.manualId)}
        onCancel={() => setDeleting(null)}
      >
        <p>{deleting && t('cost.deleteBody', { note: deleting.note, amount: formatAmd(deleting.amountAmd), channel: name(deleting.channel) })}</p>
        {remove.isError && <Alert tone="danger" title={t('m.notSaved')}>{remove.error.message}</Alert>}
      </ConfirmDialog>
    </>
  );
}

type TrendRow = Record<string, number | string> & { label: string; start: string };

/** Spend by channel over time (stacked columns) and where the money went in the period (donut). */
function SpendCharts({
  trend,
  summary,
  channels,
  loading,
  period,
}: {
  trend: CostTrend | undefined;
  summary: { channel: string; adSpendAmd: number; manualAmd: number; totalAmd: number }[];
  channels: Channel[] | undefined;
  loading: boolean;
  period: { from: string; to: string };
}) {
  const t = useT();
  const bucketLabel = useBucketLabel();
  const name = (id: string) => (id === 'other' ? t('cost.otherChannels') : channelName(id, channels));
  // Five biggest channels by name, the rest together, so the colours stay within the six chart tokens.
  const ranked = [...summary].filter((row) => row.totalAmd > 0).sort((a, b) => b.totalAmd - a.totalAmd);
  // Five channels by name at most; the rest fold into a neutral "Other" (chart slot 6), never a sixth hue.
  const shown = ranked.slice(0, 5).map((row) => row.channel);
  const keyOf = (channel: string) => (shown.includes(channel) ? channel : 'other');
  const seriesKeys = [...shown, ...(ranked.length > shown.length ? ['other'] : [])];
  const rows: TrendRow[] = (trend?.points ?? []).map((point) => {
    const row: TrendRow = { start: point.start, label: bucketLabel(point.start, trend!.granularity) };
    for (const key of seriesKeys) row[key] = 0;
    for (const [channel, value] of Object.entries(point.channels)) if (value > 0) row[keyOf(channel)] = (row[keyOf(channel)] as number) + value;
    return row;
  });
  const total = ranked.reduce((sum, row) => sum + row.totalAmd, 0);
  const slices = seriesKeys.map((key) => ({
    label: name(key),
    value: ranked.filter((row) => keyOf(row.channel) === key).reduce((sum, row) => sum + row.totalAmd, 0),
    ...(key === 'other' ? { color: 'var(--chart-6)' } : {}),
  }));
  const top = ranked[0];

  return (
    <div className="grid-12">
      <ChartCard
        className="span-8"
        title={t('cost.overTime')}
        description={trend?.granularity === 'month' ? t('ov.trendMonthly') : t('ov.trendWeekly')}
        summary={top ? t('cost.overTimeSummary', { channel: name(top.channel), amount: formatAmd(top.totalAmd), share: formatPercent(top.totalAmd / total, undefined, { maximumFractionDigits: 0 }) }) : t('chart.noData')}
        loading={loading}
        empty={!loading && total === 0}
        table={{
          columns: [
            { key: 'label', header: trend?.granularity === 'month' ? t('m.month') : t('m.weekOf') },
            ...seriesKeys.map((key) => ({ key, header: name(key), numeric: true, render: (row: TrendRow) => formatAmd(row[key] as number), sortValue: (row: TrendRow) => row[key] as number })),
          ],
          rows,
          rowKey: (row) => row.start,
          exportFile: `spend-by-channel-${period.from}-${period.to}`,
        }}
      >
        <BarChart data={rows} categoryKey="label" stacked format={compact} series={seriesKeys.map((key) => ({ key, label: name(key), ...(key === 'other' ? { color: 'var(--chart-6)' } : {}) }))} label={t('cost.overTime')} />
      </ChartCard>
      <ChartCard
        className="span-4"
        title={t('cost.byChannel')}
        summary={top ? t('cost.byChannelSummary', { n: formatNumber(ranked.length) }) : t('chart.noData')}
        loading={loading}
        empty={!loading && total === 0}
        table={{
          columns: [
            { key: 'channel', header: t('m.channel'), render: (row) => name(row.channel), sortValue: (row) => name(row.channel) },
            { key: 'ads', header: t('cost.adSpend'), numeric: true, render: (row) => formatAmd(row.adSpendAmd), sortValue: (row) => row.adSpendAmd },
            { key: 'manual', header: t('cost.otherCosts'), numeric: true, render: (row) => formatAmd(row.manualAmd), sortValue: (row) => row.manualAmd },
            { key: 'total', header: t('m.spend'), numeric: true, render: (row) => <strong>{formatAmd(row.totalAmd)}</strong>, sortValue: (row) => row.totalAmd },
          ],
          rows: summary,
          rowKey: (row) => row.channel,
          exportFile: `channel-costs-${period.from}-${period.to}`,
        }}
      >
        <DonutChart data={slices} format={(value) => formatAmd(value)} label={t('cost.byChannel')} centerLabel={compact(total)} />
      </ChartCard>
    </div>
  );
}

type CostFormState = ReturnType<typeof blank>;

/** Add or edit a manual cost (ANL-05): stored in AMD at the CBA rate of the first day, original amount kept. */
function CostForm({
  className,
  form,
  setForm,
  editing,
  onDone,
  onCancel,
  channels,
  currencies,
}: {
  className: string;
  form: CostFormState;
  setForm: (update: (current: CostFormState) => CostFormState) => void;
  editing: CostEntry | null;
  onDone: () => void;
  onCancel: () => void;
  channels: Channel[];
  currencies: string[];
}) {
  const t = useT();
  const role = useStaffRole();
  const registry = useQuery({ queryKey: ['campaign-registry', role], queryFn: listCampaignRegistry });
  const set = (key: keyof CostFormState) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const input = { ...form, campaign: form.campaign.trim() || null, amount: Number(form.amount.replace(/\s/g, '').replace(',', '.')) };
      return editing?.manualId ? updateCost(editing.manualId, input) : createCost(input);
    },
    onSuccess: onDone,
  });
  const error = save.error instanceof ApiError ? save.error : null;
  const fieldError = (field: string) => (error?.details.field === field ? error.message : undefined);
  const campaigns = (registry.data?.campaigns ?? []).filter((campaign) => !form.channel || campaign.channel === form.channel);
  const campaignOptions = [
    { value: '', label: t('cost.wholeChannel') },
    ...campaigns.map((campaign) => ({ value: campaign.key, label: campaign.name === campaign.key ? campaign.key : `${campaign.name} (${campaign.key})` })),
    // An edited cost can name a campaign that is not in the list.
    ...(form.campaign && !campaigns.some((campaign) => campaign.key === form.campaign) ? [{ value: form.campaign, label: form.campaign }] : []),
  ];

  return (
    <section className={`card stack ${className}`} aria-labelledby="cost-form-heading">
      <h2 id="cost-form-heading">{editing ? t('cost.editTitle') : t('cost.addTitle')}</h2>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="form-row">
          <SelectField
            label={t('m.channel')}
            required
            value={form.channel}
            onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value, campaign: '' }))}
            error={fieldError('channel')}
            options={[{ value: '', label: t('m.choose') }, ...channels.map((item) => ({ value: item.id, label: item.name }))]}
          />
          <SelectField label={t('cost.campaignOptional')} value={form.campaign} onChange={set('campaign')} options={campaignOptions} hint={t('cost.campaignHint')} />
        </div>
        <div className="form-row">
          <TextField label={t('filter.from')} type="date" required value={form.dateFrom} onChange={set('dateFrom')} error={fieldError('dateFrom')} />
          <TextField label={t('filter.to')} type="date" required value={form.dateTo} min={form.dateFrom} onChange={set('dateTo')} error={fieldError('dateTo')} />
        </div>
        <div className="form-row">
          <TextField label={t('cost.amount')} required inputMode="decimal" value={form.amount} onChange={set('amount')} error={fieldError('amount')} />
          <SelectField
            label={t('cost.currency')}
            required
            value={form.currency}
            onChange={set('currency')}
            error={fieldError('currency')}
            hint={form.currency === 'AMD' ? undefined : t('cost.currencyHint')}
            options={currencies.map((code) => ({ value: code, label: code }))}
          />
        </div>
        <TextField label={t('cost.note')} required value={form.description} onChange={set('description')} error={fieldError('description')} placeholder={t('cost.notePlaceholder')} />
        <div className="cluster">
          <Button type="submit" variant="primary" icon={<CurrencyCircleDollar size={18} aria-hidden />} loading={save.isPending} disabled={!form.description.trim() || !form.channel || !form.amount}>
            {editing ? t('m.saveChanges') : t('cost.addCost')}
          </Button>
          {editing && (
            <Button variant="ghost" onClick={onCancel}>
              {t('m.cancel')}
            </Button>
          )}
        </div>
        {error && !error.details.field && <Alert tone="danger" title={t('m.notSaved')}>{error.message}</Alert>}
      </form>
    </section>
  );
}

/** Exchange rates (9.2): the latest rate per currency; managers enter a rate for a date. */
function RatesCard({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const dayLabel = useDayLabel();
  const rates = useQuery({ queryKey: ['rates', role], queryFn: getRates });
  const [form, setForm] = useState({ currency: 'USD', date: yerevanToday(), amount: '' });
  const save = useMutation({
    mutationFn: () => saveRate({ currency: form.currency, date: form.date, rateToAmd: Number(form.amount.replace(',', '.')) }),
    onSuccess: () => {
      setForm((current) => ({ ...current, amount: '' }));
      void queryClient.invalidateQueries({ queryKey: ['rates'] });
    },
  });
  const error = save.error instanceof ApiError ? save.error : null;
  const origin = { demo: t('cost.rateDemo'), manual: t('cost.rateManual'), cba: t('cost.rateCba') };
  return (
    <section className="card stack" aria-labelledby="rates-heading">
      <div>
        <h2 id="rates-heading">{t('cost.rates')}</h2>
        <p className="muted">{rates.data?.source === 'demo' ? t('cost.ratesDemoHint') : t('cost.ratesHint')}</p>
      </div>
      {rates.isError && <Alert tone="danger" title={t('m.notLoaded')}>{rates.error.message}</Alert>}
      <ul className="rate-list list-reset" aria-label={t('cost.rates')}>
        {(rates.data?.latest ?? []).map((rate) => (
          <li key={rate.currency}>
            <StatusBadge tone="info">
              <span className="num">
                1 {rate.currency} = {formatNumber(rate.rateToAmd, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AMD · {dayLabel(rate.date, true)}
              </span>
            </StatusBadge>
            <span className="muted rate-list__origin">{rate.origin ? origin[rate.origin] : ''}</span>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="form-row form-row--end"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <SelectField label={t('cost.currency')} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })} options={['USD', 'EUR', 'RUB', 'GBP'].map((code) => ({ value: code, label: code }))} />
          <TextField label={t('cost.rateDate')} type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} error={error?.details.field === 'date' ? error.message : undefined} />
          <TextField
            label={t('cost.rateAmd')}
            required
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
            error={error?.details.field === 'rateToAmd' ? error.message : undefined}
          />
          <Button type="submit" variant="secondary" loading={save.isPending} disabled={!form.amount}>
            {t('cost.saveRate')}
          </Button>
        </form>
      )}
      {save.isSuccess && (
        <p role="status" className="note">
          {t('cost.rateSaved')}
        </p>
      )}
      {error && !['date', 'rateToAmd'].includes(String(error.details.field)) && <Alert tone="danger" title={t('m.notSaved')}>{error.message}</Alert>}
    </section>
  );
}

/** Ad report CSV (9.1 fallback while API access is pending). Nothing is saved unless every row is valid. */
function AdCsvCard({ onImported }: { onImported: () => void }) {
  const t = useT();
  const [platform, setPlatform] = useState<'meta_ads' | 'google_ads'>('meta_ads');
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({ mutationFn: async () => uploadAdSpendCsv(platform, await (file as File).text()), onSuccess: onImported });
  const error = upload.error instanceof ApiError ? upload.error : null;
  return (
    <section className="card stack" aria-labelledby="ad-csv-heading">
      <div>
        <h2 id="ad-csv-heading">{t('cost.csvTitle')}</h2>
        <p className="muted">
          {t('cost.csvColumns')} <code>date, campaign_id, campaign_name, spend, currency</code>; {t('cost.csvOptional')} <code>utm_campaign, impressions, clicks, leads</code>.
        </p>
      </div>
      <form
        className="cluster cluster--end"
        onSubmit={(event) => {
          event.preventDefault();
          upload.mutate();
        }}
      >
        <div className="segmented segmented--compact" role="group" aria-label={t('cost.platform')}>
          {(['meta_ads', 'google_ads'] as const).map((value) => (
            <button key={value} type="button" className="segmented__btn" aria-pressed={platform === value} onClick={() => setPlatform(value)}>
              {value === 'meta_ads' ? 'Meta Ads' : 'Google Ads'}
            </button>
          ))}
        </div>
        <label className="file-input">
          <input className="visually-hidden" type="file" accept=".csv,text/csv" aria-label={t('cost.csvFile')} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <span className="btn btn--secondary btn--sm" aria-hidden>
            {t('cost.chooseFile')}
          </span>
          <span className="muted file-input__name">{file?.name ?? t('cost.noFile')}</span>
        </label>
        <Button type="submit" variant="secondary" icon={<FileArrowUp size={18} aria-hidden />} disabled={!file} loading={upload.isPending}>
          {t('cost.import')}
        </Button>
      </form>
      <p role="status" className="note">
        {upload.isSuccess ? t('cost.imported', { n: formatNumber(upload.data.rowsUpserted), range: upload.data.range ? `${upload.data.range.from} – ${upload.data.range.to}` : '—' }) : ''}
      </p>
      {upload.isError && (
        <Alert tone="danger" title={t('cost.notImported')}>
          {upload.error.message}
          {error?.details.rows && (
            <ul className="list-reset">
              {error.details.rows.slice(0, 10).map((row) => (
                <li key={`${row.line}-${row.message}`}>
                  {t('cost.line', { n: row.line })}: {row.message}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </section>
  );
}
