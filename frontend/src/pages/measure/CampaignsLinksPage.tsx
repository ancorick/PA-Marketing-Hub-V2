import { LinkSimple, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useEffect, useState } from 'react';
import {
  addChannelRule,
  ApiError,
  createCampaignRecord,
  createTrackedLink,
  deleteChannelRule,
  getTaxonomy,
  listCampaignRegistry,
  listCampaignResults,
  listTrackedLinks,
  updateCampaignRecord,
  type CampaignRecord,
  type CampaignRow,
  type ChannelRule,
  type LinkChannel,
  type RuleKind,
  type TrackedLink,
} from '../../lib/api';
import { formatAmd, formatDate, formatNumber } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import {
  AccessNotice,
  accessProblem,
  Alert,
  AttributionFilter,
  Button,
  ChartCard,
  CopyButton,
  DataTable,
  FilterBar,
  Modal,
  PageHeader,
  PeriodFilter,
  SelectField,
  SkeletonCard,
  Tag,
  TextField,
  type Column,
} from '../../ui';
import { campaignColumns } from '../analytics/campaignColumns';
import { useModel, usePeriod } from '../analytics/period';
import { amd, BarChart, chartCount, chartCountFormat, modelName, useDayLabel } from './shared';

const MARKETING = ['editor', 'marketing_manager', 'admin'];

/**
 * Campaigns & links (PRD 9.3, ANL-03, ANL-04, ANL-09; RESTRUCTURE R3): the link builder, the channel taxonomy,
 * results per campaign, the campaign list with budgets, tracked links and the channel rules.
 */
export function CampaignsLinksPage() {
  const t = useT();
  const role = useStaffRole();
  const marketing = MARKETING.includes(role);
  const canManage = role === 'admin' || role === 'marketing_manager';
  const [period, setPeriod] = usePeriod();
  const [model, setModel] = useModel();
  const [editing, setEditing] = useState<CampaignRecord | 'new' | null>(null);
  const links = useQuery({ queryKey: ['tracked-links', role], queryFn: listTrackedLinks, enabled: marketing });
  const registry = useQuery({ queryKey: ['campaign-registry', role], queryFn: listCampaignRegistry, enabled: marketing });
  const results = useQuery({ queryKey: ['campaign-results', role, period, model], queryFn: () => listCampaignResults(period, model) });
  const channels = links.data?.channels ?? [];

  return (
    <>
      <PageHeader
        title={t('cl.title')}
        accent={t('cl.titleAccent')}
        description={t('cl.description')}
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setEditing('new')}>
              {t('cl.newCampaign')}
            </Button>
          )
        }
      />
      <FilterBar label={t('m.filters')}>
        <PeriodFilter value={period} onChange={setPeriod} />
        <AttributionFilter value={model} onChange={setModel} />
      </FilterBar>
      <div className="stack stack--lg">
        {marketing ? (
          <div className="grid-12">
            <LinkBuilderCard className="span-6" channels={channels} campaigns={registry.data?.campaigns ?? []} loading={links.isPending || registry.isPending} error={links.error ?? registry.error} />
            <TaxonomyCard className="span-6" channels={channels} loading={links.isPending} />
          </div>
        ) : (
          <AccessNotice problem={403} title={t('cl.marketingOnly')}>
            {t('cl.marketingOnlyHint')}
          </AccessNotice>
        )}

        <Suspense fallback={<SkeletonCard />}>
          <ResultsChart rows={results.data?.campaigns ?? []} names={registry.data?.campaigns ?? []} shared={results.data?.shared ?? false} modelLabel={modelName(t, results.data?.modelLabel ?? '')} loading={results.isPending} error={results.error} period={period} model={model} />
        </Suspense>

        {marketing && (
          <CampaignListCard campaigns={registry.data?.campaigns ?? []} results={results.data?.campaigns ?? []} channels={channels} loading={registry.isPending} canManage={canManage} onEdit={setEditing} />
        )}
        {marketing && <TrackedLinksCard links={links.data?.links ?? []} channels={channels} loading={links.isPending} />}
        {marketing && <ChannelRulesCard canEdit={canManage} />}
      </div>
      {canManage && <CampaignModal editing={editing} channels={channels} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Link builder (ANL-04): pick a campaign; channel, source and medium come from the taxonomy. */
function LinkBuilderCard({ className, channels, campaigns, loading, error }: { className: string; channels: LinkChannel[]; campaigns: CampaignRecord[]; loading: boolean; error: Error | null }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ destinationUrl: 'https://', campaign: '', source: '', content: '', label: '' });
  const campaign = campaigns.find((item) => item.key === form.campaign);
  const channel = channels.find((item) => item.id === campaign?.channel);
  // A new campaign choice resets the source to the channel's default tag.
  useEffect(() => {
    setForm((current) => ({ ...current, source: channel?.defaultSource ?? '' }));
  }, [channel?.id, channel?.defaultSource]);
  const create = useMutation({
    mutationFn: () => createTrackedLink({ destinationUrl: form.destinationUrl, channel: channel!.id, source: form.source, campaign: form.campaign, content: form.content || null, label: form.label || null }),
    onSuccess: () => {
      setForm((current) => ({ ...current, destinationUrl: 'https://', content: '', label: '' }));
      void queryClient.invalidateQueries({ queryKey: ['tracked-links'] });
    },
  });
  const apiError = create.error instanceof ApiError ? create.error : null;
  const fieldError = (name: string) => (apiError?.details.field === name ? apiError.message : undefined);
  const access = accessProblem(error);
  const linkable = campaigns.filter((item) => item.channel);
  const sources = channel ? [...new Set([channel.defaultSource, ...channel.sources])] : [];

  return (
    <section className={`card stack ${className}`} aria-labelledby="builder-heading">
      <div>
        <h2 id="builder-heading">{t('cl.linkBuilder')}</h2>
        <p className="muted">{t('cl.linkBuilderHint')}</p>
      </div>
      {access && (
        <AccessNotice problem={access} title={t('cl.marketingOnly')}>
          {t('cl.marketingOnlyHint')}
        </AccessNotice>
      )}
      {loading ? (
        <SkeletonCard />
      ) : (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <TextField label={t('cl.destination')} required type="url" value={form.destinationUrl} onChange={(event) => setForm({ ...form, destinationUrl: event.target.value })} error={fieldError('destinationUrl')} />
          <div className="form-row">
            <SelectField
              label={t('m.campaign')}
              required
              value={form.campaign}
              onChange={(event) => setForm({ ...form, campaign: event.target.value })}
              error={fieldError('campaign')}
              options={[{ value: '', label: t('m.choose') }, ...linkable.map((item) => ({ value: item.key, label: item.name }))]}
              hint={campaign && channel ? t('cl.campaignTags', { channel: channel.name, campaign: campaign.key }) : undefined}
            />
            <SelectField
              label={t('cl.source')}
              required
              value={form.source}
              disabled={!channel}
              onChange={(event) => setForm({ ...form, source: event.target.value })}
              error={fieldError('source')}
              options={sources.length ? sources.map((value) => ({ value, label: `${value} / ${channel!.medium}` })) : [{ value: '', label: '—' }]}
            />
          </div>
          <div className="form-row">
            <TextField label={t('cl.content')} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} hint={t('cl.contentHint')} />
            <TextField label={t('cl.noteForTeam')} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
          </div>
          <div className="cluster">
            <Button type="submit" variant="secondary" icon={<LinkSimple size={18} aria-hidden />} loading={create.isPending} disabled={!channel || !form.source || form.destinationUrl.length < 10}>
              {t('cl.createLink')}
            </Button>
          </div>
          {apiError && !apiError.details.field && <Alert tone="danger" title={t('m.notSaved')}>{apiError.message}</Alert>}
        </form>
      )}
      {create.data && (
        <div className="inset stack stack--sm" role="status">
          <strong>{t('cl.linkReady')}</strong>
          <span className="cluster cluster--nowrap">
            <code>{create.data.shortUrl}</code>
            <CopyButton value={create.data.shortUrl} label={t('cl.copyShort')} />
          </span>
          <span className="cluster cluster--nowrap">
            <code className="muted block-body">{create.data.fullUrl}</code>
            <CopyButton value={create.data.fullUrl} label={t('cl.copyFull')} />
          </span>
        </div>
      )}
    </section>
  );
}

/** Channel taxonomy (9.3): group and default tags of every channel. */
function TaxonomyCard({ className, channels, loading }: { className: string; channels: LinkChannel[]; loading: boolean }) {
  const t = useT();
  const columns: Column<LinkChannel>[] = [
    { key: 'name', header: t('m.channel'), render: (row) => <a href={`#/channels/${row.id}`}>{row.name}</a>, sortValue: (row) => row.name },
    { key: 'group', header: t('cl.group'), render: (row) => <Tag>{t(`cl.group.${row.group}` as 'cl.group.paid')}</Tag>, sortValue: (row) => row.group },
    { key: 'tags', header: t('cl.defaultTags'), render: (row) => <code>{`${row.defaultSource} / ${row.medium}`}</code>, csv: (row) => `${row.defaultSource} / ${row.medium}` },
  ];
  return (
    <section className={`card stack ${className}`} aria-labelledby="taxonomy-heading">
      <div>
        <h2 id="taxonomy-heading">{t('cl.taxonomy')}</h2>
        <p className="muted">{t('cl.taxonomyHint')}</p>
      </div>
      <DataTable caption={t('cl.taxonomy')} captionHidden columns={columns} rows={channels} rowKey={(row) => row.id} loading={loading} />
    </section>
  );
}

/** Leads and enrolled students per campaign under the chosen model; the table view lists every campaign. */
function ResultsChart({
  rows,
  names,
  shared,
  modelLabel,
  loading,
  error,
  period,
  model,
}: {
  rows: CampaignRow[];
  names: CampaignRecord[];
  shared: boolean;
  modelLabel: string;
  loading: boolean;
  error: Error | null;
  period: { from: string; to: string };
  model: string;
}) {
  const t = useT();
  const format = chartCountFormat(shared);
  const label = (key: string) => (key === '(no campaign)' ? t('cl.noCampaign') : (names.find((item) => item.key === key)?.name ?? key));
  const top = rows
    .filter((row) => row.campaign !== '(no campaign)')
    .map((row) => ({ key: row.campaign, name: label(row.campaign), lead: chartCount(row.lead), enrolled: chartCount(row.enrolled) }))
    .filter((row) => row.lead > 0 || row.enrolled > 0)
    .sort((a, b) => b.lead - a.lead || b.enrolled - a.enrolled)
    .slice(0, 10);
  const access = accessProblem(error);
  if (access)
    return (
      <AccessNotice problem={access} title="Sign in to see campaign results">
        Every staff role sees campaign results.
      </AccessNotice>
    );
  const modelNote = modelLabel ? ` ${t('m.attributionNote', { model: modelLabel })}` : '';
  return (
    <ChartCard
      title={t('cl.results')}
      description={modelLabel ? t('cl.resultsHint', { model: modelLabel }) : undefined}
      summary={top[0] ? t('cl.resultsSummary', { campaign: top[0].name, n: format(top[0].lead) }) : t('chart.noData')}
      loading={loading}
      empty={!loading && top.length === 0}
      table={{
        columns: campaignColumns({ modelNote, marketing: false }),
        rows,
        rowKey: (row) => row.campaign,
        exportFile: `campaign-results-${period.from}-${period.to}-${model}`,
      }}
    >
      <BarChart
        data={top}
        categoryKey="name"
        layout="horizontal"
        format={format}
        series={[
          { key: 'lead', label: t('m.leads') },
          { key: 'enrolled', label: t('m.enrolled') },
        ]}
        label={t('cl.results')}
      />
    </ChartCard>
  );
}

/** Campaign list (12.3) with channel, dates, budget and spend in the period; managers edit. */
function CampaignListCard({
  campaigns,
  results,
  channels,
  loading,
  canManage,
  onEdit,
}: {
  campaigns: CampaignRecord[];
  results: CampaignRow[];
  channels: LinkChannel[];
  loading: boolean;
  canManage: boolean;
  onEdit: (campaign: CampaignRecord) => void;
}) {
  const t = useT();
  const dayLabel = useDayLabel();
  const [query, setQuery] = useState('');
  const channelLabel = (id: string | null) => channels.find((item) => item.id === id)?.name ?? '—';
  const spend = (key: string) => results.find((row) => row.campaign === key)?.costAmd ?? 0;
  const needle = query.trim().toLowerCase();
  const rows = needle ? campaigns.filter((row) => `${row.name} ${row.key} ${channelLabel(row.channel)}`.toLowerCase().includes(needle)) : campaigns;
  const dates = (row: CampaignRecord) =>
    !row.dateFrom ? '—' : !row.dateTo ? t('cl.since', { date: dayLabel(row.dateFrom, true) }) : row.dateFrom === row.dateTo ? dayLabel(row.dateFrom, true) : `${dayLabel(row.dateFrom, true)} – ${dayLabel(row.dateTo, true)}`;
  const columns: Column<CampaignRecord>[] = [
    {
      key: 'name',
      header: t('m.campaign'),
      render: (row) => (
        <span className="stack stack--xs">
          <a href={`#/campaigns-links/${encodeURIComponent(row.key)}`}>{row.name}</a>
          {!row.registered && <span className="muted text-xs">{t('cl.notSaved')}</span>}
        </span>
      ),
      sortValue: (row) => row.name,
    },
    { key: 'channel', header: t('m.channel'), render: (row) => <span className="nowrap">{channelLabel(row.channel)}</span>, sortValue: (row) => channelLabel(row.channel) },
    { key: 'key', header: 'utm_campaign', render: (row) => <code>{row.key}</code>, sortValue: (row) => row.key },
    { key: 'dates', header: t('cl.dates'), render: (row) => <span className="nowrap num">{dates(row)}</span>, sortValue: (row) => row.dateFrom ?? '', csv: (row) => `${row.dateFrom ?? ''} – ${row.dateTo ?? ''}` },
    { key: 'budget', header: t('cl.budget'), numeric: true, render: (row) => <span className={row.budgetAmd === null ? 'muted' : undefined}>{amd(row.budgetAmd)}</span>, sortValue: (row) => row.budgetAmd ?? -1, csv: (row) => row.budgetAmd },
    { key: 'spend', header: t('cl.spendInPeriod'), numeric: true, render: (row) => (spend(row.key) ? formatAmd(spend(row.key)) : <span className="muted">—</span>), sortValue: (row) => spend(row.key), bar: (row) => spend(row.key) || null },
    ...(canManage
      ? [
          {
            key: 'edit',
            header: t('m.actions'),
            render: (row: CampaignRecord) => (
              <Button size="sm" variant="ghost" icon={<PencilSimple size={16} aria-hidden />} onClick={() => onEdit(row)} aria-label={`${t('m.edit')}: ${row.name}`}>
                {t('m.edit')}
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <section className="card stack" aria-labelledby="campaign-list-heading">
      <div className="card__header">
        <div>
          <h2 id="campaign-list-heading">{t('cl.campaigns')}</h2>
          <p className="muted">{t('cl.campaignsHint')}</p>
        </div>
        <label className="filter">
          <span className="visually-hidden">{t('cl.filter')}</span>
          <input className="input input--sm" type="search" placeholder={t('cl.filter')} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <DataTable
        caption={t('cl.campaigns')}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        loading={loading}
        pageSize={15}
        exportFile="campaigns"
        empty={needle ? t('cl.noMatch') : t('cl.noCampaigns')}
      />
    </section>
  );
}

/** Tracked links with their short-link clicks. */
function TrackedLinksCard({ links, channels, loading }: { links: TrackedLink[]; channels: LinkChannel[]; loading: boolean }) {
  const t = useT();
  const channelLabel = (id: string) => channels.find((item) => item.id === id)?.name ?? id;
  const columns: Column<TrackedLink>[] = [
    {
      key: 'link',
      header: t('cl.link'),
      render: (row) => (
        <div className="stack stack--xs">
          <span className="text-wrap">{row.label ?? row.destinationUrl}</span>
          <span className="cluster cluster--nowrap">
            <code className="muted">{row.shortUrl}</code>
            <CopyButton value={row.shortUrl} label={`${t('cl.copyShort')} ${row.shortUrl}`} />
          </span>
        </div>
      ),
      sortValue: (row) => row.label ?? row.destinationUrl,
      csv: (row) => `${row.label ?? row.destinationUrl} ${row.shortUrl} ${row.fullUrl}`,
    },
    { key: 'channel', header: t('m.channel'), render: (row) => channelLabel(row.channel), sortValue: (row) => channelLabel(row.channel) },
    { key: 'campaign', header: 'utm_campaign', render: (row) => <code>{row.utmCampaign}</code>, sortValue: (row) => row.utmCampaign },
    { key: 'source', header: 'utm_source / utm_medium', render: (row) => <code>{`${row.utmSource} / ${row.utmMedium}`}</code>, csv: (row) => `${row.utmSource} / ${row.utmMedium}` },
    { key: 'clicks', header: t('cl.clicks'), numeric: true, render: (row) => formatNumber(row.clicks), sortValue: (row) => row.clicks, bar: (row) => row.clicks },
    { key: 'created', header: t('cl.created'), render: (row) => <span className="num nowrap">{formatDate(row.createdAt)}</span>, sortValue: (row) => row.createdAt },
  ];
  return (
    <section className="card stack" aria-labelledby="links-heading">
      <h2 id="links-heading">{t('cl.trackedLinks')}</h2>
      <DataTable
        caption={t('cl.trackedLinks')}
        captionHidden
        columns={columns}
        rows={links}
        rowKey={(row) => row.id}
        loading={loading}
        pageSize={10}
        initialSort={{ key: 'created', direction: 'descending' }}
        exportFile="tracked-links"
        empty={t('cl.noLinks')}
      />
    </section>
  );
}

const KIND_LABEL: Record<RuleKind, string> = { source_medium: 'utm_source / utm_medium', medium: 'utm_medium', source: 'utm_source', crm_label: 'CRM label' };

/** Channel rules (9.3, ANL-03): staff rules before built-in ones; managers add and delete. */
function ChannelRulesCard({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const taxonomy = useQuery({ queryKey: ['taxonomy', role], queryFn: getTaxonomy });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['taxonomy'] });
  const [rule, setRule] = useState<{ kind: RuleKind; value: string; channel: string }>({ kind: 'source_medium', value: '', channel: '' });
  const add = useMutation({
    mutationFn: () => addChannelRule(rule),
    onSuccess: () => {
      setRule((current) => ({ ...current, value: '' }));
      refresh();
    },
  });
  const addError = add.error instanceof ApiError ? add.error : null;
  const remove = useMutation({ mutationFn: (id: string) => deleteChannelRule(id), onSuccess: refresh });
  const channels = taxonomy.data?.channels ?? [];
  const channelLabel = (id: string) => channels.find((item) => item.id === id)?.name ?? id;
  const columns: Column<ChannelRule>[] = [
    { key: 'kind', header: t('cl.matches'), render: (row) => KIND_LABEL[row.kind], csv: (row) => KIND_LABEL[row.kind] },
    { key: 'value', header: t('cl.value'), render: (row) => <code>{row.value}</code>, sortValue: (row) => row.value },
    { key: 'channel', header: t('m.channel'), render: (row) => channelLabel(row.channel), sortValue: (row) => channelLabel(row.channel) },
    {
      key: 'origin',
      header: t('cl.addedBy'),
      render: (row) =>
        row.builtIn ? (
          <span className="muted">{t('cl.builtIn')}</span>
        ) : (
          <div className="cluster cluster--nowrap">
            <span>{row.createdBy}</span>
            {canEdit && row.id && (
              <Button size="sm" variant="ghost" iconOnly aria-label={`${t('m.delete')}: ${row.value}`} icon={<Trash size={16} aria-hidden />} loading={remove.isPending && remove.variables === row.id} onClick={() => remove.mutate(row.id!)} />
            )}
          </div>
        ),
    },
  ];
  return (
    <section className="card stack" aria-labelledby="rules-heading">
      <div>
        <h2 id="rules-heading">{t('cl.rules')}</h2>
        <p className="muted">{t('cl.rulesHint')}</p>
      </div>
      {taxonomy.isError && <Alert tone="danger" title={t('m.notLoaded')}>{taxonomy.error.message}</Alert>}
      {canEdit && (
        <form
          className="form-row form-row--end"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <SelectField label={t('cl.matches')} value={rule.kind} onChange={(event) => setRule({ ...rule, kind: event.target.value as RuleKind })} options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />
          <TextField label={t('cl.value')} required value={rule.value} placeholder="tiktok/influencer" onChange={(event) => setRule({ ...rule, value: event.target.value })} error={addError?.details.field === 'value' ? addError.message : undefined} />
          <SelectField label={t('m.channel')} required value={rule.channel} onChange={(event) => setRule({ ...rule, channel: event.target.value })} options={[{ value: '', label: t('m.choose') }, ...channels.map((item) => ({ value: item.id, label: item.name }))]} />
          <Button type="submit" variant="secondary" disabled={!rule.value.trim() || !rule.channel} loading={add.isPending}>
            {t('cl.addRule')}
          </Button>
        </form>
      )}
      {add.isError && addError?.details.field !== 'value' && <Alert tone="danger" title={t('m.notSaved')}>{add.error.message}</Alert>}
      <DataTable caption={t('cl.rules')} captionHidden columns={columns} rows={taxonomy.data?.rules ?? []} rowKey={(row) => row.id ?? `${row.kind}:${row.value}`} loading={taxonomy.isPending} pageSize={10} exportFile="channel-rules" />
    </section>
  );
}

/** New campaign, or name, channel, dates and budget of an existing one. */
function CampaignModal({ editing, channels, onClose }: { editing: CampaignRecord | 'new' | null; channels: LinkChannel[]; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const isNew = editing === 'new';
  const record = editing && editing !== 'new' ? editing : null;
  const [form, setForm] = useState({ name: '', key: '', channel: '', dateFrom: '', dateTo: '', budget: '' });
  const save = useMutation({
    mutationFn: () => {
      const input = {
        key: form.key.trim() || null,
        name: form.name,
        channel: form.channel,
        dateFrom: form.dateFrom || null,
        dateTo: form.dateTo || null,
        budgetAmd: form.budget.trim() ? Number(form.budget.replace(/[\s,]/g, '')) : null,
      };
      return record ? updateCampaignRecord(record.key, input) : createCampaignRecord(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign-registry'] });
      onClose();
    },
  });
  const { reset } = save;
  // Opening the modal fills the form from the campaign (or empties it) and clears the last error.
  useEffect(() => {
    if (!editing) return;
    setForm(
      editing !== 'new'
        ? { name: editing.name, key: editing.key, channel: editing.channel ?? '', dateFrom: editing.dateFrom ?? '', dateTo: editing.dateTo ?? '', budget: editing.budgetAmd === null ? '' : String(editing.budgetAmd) }
        : { name: '', key: '', channel: '', dateFrom: '', dateTo: '', budget: '' },
    );
    reset();
  }, [editing, reset]);
  const error = save.error instanceof ApiError ? save.error : null;
  const fieldError = (name: string) => (error?.details.field === name ? error.message : undefined);
  const suggestedKey = form.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={isNew ? t('cl.newCampaign') : t('cl.editCampaign')}
      description={isNew ? t('cl.newCampaignHint') : record && !record.registered ? t('cl.saveSeenHint') : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('m.cancel')}
          </Button>
          <Button variant="primary" form="campaign-form" type="submit" loading={save.isPending} disabled={!form.name.trim() || !form.channel}>
            {isNew ? t('cl.createCampaign') : t('m.saveChanges')}
          </Button>
        </>
      }
    >
      <form
        id="campaign-form"
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <TextField label={t('cl.campaignName')} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} error={fieldError('name')} />
        <TextField
          label="utm_campaign"
          value={isNew ? form.key : (record?.key ?? '')}
          readOnly={!isNew}
          placeholder={suggestedKey}
          onChange={(event) => setForm({ ...form, key: event.target.value })}
          error={fieldError('key')}
          hint={isNew ? t('cl.keyHint') : t('cl.keyFixed')}
        />
        <SelectField
          label={t('m.channel')}
          required
          value={form.channel}
          onChange={(event) => setForm({ ...form, channel: event.target.value })}
          error={fieldError('channel')}
          options={[{ value: '', label: t('m.choose') }, ...channels.map((item) => ({ value: item.id, label: item.name }))]}
        />
        <div className="form-row">
          <TextField label={t('filter.from')} type="date" value={form.dateFrom} onChange={(event) => setForm({ ...form, dateFrom: event.target.value })} error={fieldError('dateFrom')} />
          <TextField label={t('filter.to')} type="date" value={form.dateTo} min={form.dateFrom || undefined} onChange={(event) => setForm({ ...form, dateTo: event.target.value })} error={fieldError('dateTo')} hint={t('cl.openEnded')} />
        </div>
        <TextField label={t('cl.budgetAmd')} inputMode="numeric" value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })} error={fieldError('budgetAmd')} hint={t('cl.budgetHint')} />
        {error && !error.details.field && <Alert tone="danger" title={t('m.notSaved')}>{error.message}</Alert>}
        {record && record.seenIn.length > 0 && (
          <p className="note">
            {t('cl.seenIn')} {record.seenIn.map((where) => t(`cl.seen.${where}` as 'cl.seen.links')).join(', ')}
          </p>
        )}
      </form>
    </Modal>
  );
}
