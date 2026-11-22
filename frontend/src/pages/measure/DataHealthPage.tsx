import { ArrowClockwise } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getDataHealth, getTaxonomy, rerunSource, resolveUnmapped, runJob, type SourceHealth, type UnmappedValue } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import { useT, type StringKey } from '../../lib/i18n';
import { yerevanToday } from '../../lib/periods';
import { useStaffRole } from '../../lib/session';
import {
  AccessNotice,
  accessProblem,
  Alert,
  Button,
  DataTable,
  downloadCsv,
  PageHeader,
  SelectField,
  SkeletonCard,
  StatTile,
  StatusBadge,
  tableCsv,
  Tag,
  TextField,
  type Column,
  type Tone,
} from '../../ui';
import { ExportCsvButton } from './shared';

const STATUS: Record<SourceHealth['status'], { tone: Tone; label: StringKey }> = {
  ok: { tone: 'success', label: 'dh.ok' },
  stale: { tone: 'warning', label: 'dh.stale' },
  failing: { tone: 'danger', label: 'dh.failing' },
  never_run: { tone: 'neutral', label: 'dh.neverRun' },
  running: { tone: 'info', label: 'dh.running' },
};
const SOURCE_LABEL: Record<string, string> = { website: 'Website', website_analytics: 'Website analytics', website_form: 'Website form', navigator_crm: 'Navigator CRM', link_builder: 'Link builder', event_hub: 'Event Hub' };
const time = (iso: string | null) => (iso ? formatDate(iso, undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const monthAgo = () => new Date(Date.now() + 4 * 3_600_000 - 30 * 86_400_000).toISOString().slice(0, 10);
/** Freshness targets of success metric M2: internal sources within 1 hour, external within 24 hours. */
const targetHours = (source: SourceHealth) => (source.kind === 'internal' ? 1 : 24);

/**
 * Data health (PRD 9.6, ANL-11, ANL-03; RESTRUCTURE R3): every source with its freshness against the target,
 * last successful pull, last run and rows; the values the taxonomy does not map yet; admin re-runs.
 */
export function DataHealthPage() {
  const t = useT();
  const role = useStaffRole();
  const isAdmin = role === 'admin';
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ['data-health', role], queryFn: getDataHealth, refetchInterval: 60_000 });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['data-health'] });
  const run = useMutation({ mutationFn: (name: string) => runJob(name), onSuccess: refresh });
  const data = health.data;
  const checkedAt = data ? Date.parse(data.checkedAt) : Date.now();
  const ageHours = (source: SourceHealth) => (source.lastSuccessAt ? (checkedAt - Date.parse(source.lastSuccessAt)) / 3_600_000 : null);
  const freshness = (hours: number | null) =>
    hours === null ? t('dh.noData') : hours < 1 ? t('dh.minutes', { n: Math.max(1, Math.round(hours * 60)) }) : t('dh.hours', { n: formatNumber(hours, undefined, { maximumFractionDigits: hours < 10 ? 1 : 0 }) });
  const freshTone = (source: SourceHealth): Tone => {
    const hours = ageHours(source);
    if (hours === null) return 'danger';
    const target = targetHours(source);
    return hours <= target ? 'success' : hours <= target * 2 ? 'warning' : 'danger';
  };

  const columns: Column<SourceHealth>[] = [
    {
      key: 'source',
      header: t('dh.source'),
      render: (row) => (
        <span className="stack stack--xs">
          <strong>{row.description}</strong>
          <span className="muted text-xs">{row.schedule}</span>
        </span>
      ),
      sortValue: (row) => row.description,
    },
    { key: 'kind', header: t('dh.type'), render: (row) => <Tag>{row.kind === 'external' ? t('dh.external') : t('dh.internal')}</Tag>, sortValue: (row) => row.kind },
    {
      key: 'freshness',
      header: t('dh.freshness'),
      definition: t('dh.freshnessDefinition'),
      render: (row) => (
        <span className="stack stack--xs">
          <StatusBadge tone={freshTone(row)}>{freshness(ageHours(row))}</StatusBadge>
          <span className="muted text-xs">{t('dh.target', { n: targetHours(row) })}</span>
        </span>
      ),
      sortValue: (row) => ageHours(row) ?? Number.MAX_SAFE_INTEGER,
      csv: (row) => (ageHours(row) === null ? '' : Math.round(ageHours(row)! * 10) / 10),
    },
    { key: 'success', header: t('dh.lastSuccess'), render: (row) => <span className="num nowrap">{time(row.lastSuccessAt)}</span>, sortValue: (row) => row.lastSuccessAt ?? '' },
    {
      key: 'status',
      header: t('dh.lastRun'),
      render: (row) => (
        <span className="stack stack--xs">
          <StatusBadge tone={STATUS[row.status].tone}>{t(STATUS[row.status].label)}</StatusBadge>
          {row.consecutiveFailures > 1 && <span className="field__error">{t('dh.failuresInRow', { n: row.consecutiveFailures })}</span>}
          {row.lastRun?.error && <span className="field__error text-wrap">{row.lastRun.error}</span>}
        </span>
      ),
      sortValue: (row) => row.status,
      csv: (row) => `${row.status}${row.lastRun?.error ? `: ${row.lastRun.error}` : ''}`,
    },
    {
      key: 'rows',
      header: t('dh.rows'),
      numeric: true,
      definition: t('dh.rowsDefinition'),
      render: (row) => (row.lastRun ? formatNumber(row.lastRun.rowsUpserted) : <span className="muted">—</span>),
      sortValue: (row) => row.lastRun?.rowsUpserted ?? -1,
    },
    ...(isAdmin
      ? [
          {
            key: 'run',
            header: t('m.actions'),
            render: (row: SourceHealth) => (
              <Button size="sm" variant="ghost" icon={<ArrowClockwise size={16} aria-hidden />} loading={run.isPending && run.variables === row.name} onClick={() => run.mutate(row.name)}>
                {t('dh.runNow')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const access = accessProblem(health.error);
  const count = (status: SourceHealth['status']) => data?.sources.filter((source) => source.status === status).length ?? 0;
  const failing = data?.sources.filter((source) => source.status === 'failing') ?? [];
  const unmappedTotal = data?.unmapped.reduce((sum, item) => sum + item.count, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={t('nav.dataHealth')}
        description={t('dh.description')}
        actions={data && <ExportCsvButton onExport={() => downloadCsv('data-health', tableCsv(columns, data.sources))} />}
      />
      {access ? (
        <AccessNotice problem={access} title={t('dh.accessTitle')}>
          {t('dh.accessHint')}
        </AccessNotice>
      ) : health.isPending ? (
        <SkeletonCard />
      ) : health.isError ? (
        <Alert tone="danger" title={t('m.notLoaded')}>
          {health.error.message}
        </Alert>
      ) : (
        <div className="stack stack--lg">
          <div className="grid-12">
            <div className="span-3">
              <StatTile tone="yellow" label={t('dh.tileOk')} value={`${count('ok') + count('running')} / ${data!.sources.length}`} caption={t('dh.tileOkCaption')} definition={t('dh.tileOkDefinition')} />
            </div>
            <div className="span-3">
              <StatTile label={t('dh.tileStale')} value={formatNumber(count('stale') + count('never_run'))} caption={t('dh.tileStaleCaption', { n: count('never_run') })} definition={t('dh.tileStaleDefinition')} />
            </div>
            <div className="span-3">
              <StatTile label={t('dh.tileFailing')} value={formatNumber(failing.length)} caption={t('dh.tileFailingCaption')} definition={t('dh.tileFailingDefinition')} />
            </div>
            <div className="span-3">
              <StatTile label={t('dh.tileUnmapped')} value={formatNumber(unmappedTotal)} caption={t('dh.tileUnmappedCaption')} definition={t('dh.tileUnmappedDefinition')} />
            </div>
          </div>
          {failing.length > 0 && (
            <Alert tone="danger" title={t('dh.failingAlert', { n: failing.length })}>
              {t('dh.failingAlertBody', { sources: failing.map((source) => source.description).join(', ') })}
            </Alert>
          )}
          <section className="card stack" aria-labelledby="sources-heading">
            <div className="card__header">
              <h2 id="sources-heading">{t('dh.sources')}</h2>
              <span className="muted num">{t('dh.checked', { time: time(data!.checkedAt) })}</span>
            </div>
            <DataTable caption={t('dh.sources')} captionHidden columns={columns} rows={data!.sources} rowKey={(row) => row.name} />
          </section>
          <UnmappedCard />
          <div className="grid-12">
            <section className="card stack span-6" aria-labelledby="tables-heading">
              <h2 id="tables-heading">{t('dh.cleanTables')}</h2>
              <dl className="facts facts--compact">
                <div>
                  <dt>{t('dh.webRows')}</dt>
                  <dd className="num">{formatNumber(data!.tables.webTraffic)}</dd>
                </div>
                <div>
                  <dt>{t('dh.socialRows')}</dt>
                  <dd className="num">{formatNumber(data!.tables.social)}</dd>
                </div>
                <div>
                  <dt>{t('dh.adRows')}</dt>
                  <dd className="num">{formatNumber(data!.tables.adSpend)}</dd>
                </div>
              </dl>
              <p className="note">{t('dh.rawKept')}</p>
            </section>
            {isAdmin && <RerunCard className="span-6" sources={data!.sources.filter((source) => source.kind === 'external')} onDone={refresh} />}
          </div>
        </div>
      )}
    </>
  );
}

/** Values no taxonomy rule maps yet (ANL-03): shown, never folded into "other"; managers map them here. */
function UnmappedCard() {
  const t = useT();
  const role = useStaffRole();
  const canEdit = role === 'admin' || role === 'marketing_manager';
  const queryClient = useQueryClient();
  const taxonomy = useQuery({ queryKey: ['taxonomy', role], queryFn: getTaxonomy });
  const [showResolved, setShowResolved] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['taxonomy'] });
    void queryClient.invalidateQueries({ queryKey: ['data-health'] });
  };
  const channels = taxonomy.data?.channels ?? [];
  const all = taxonomy.data?.unmapped ?? [];
  const open = all.filter((item) => !item.resolvedAt);
  const waiting = open.reduce((sum, item) => sum + item.count, 0);
  const columns: Column<UnmappedValue>[] = [
    { key: 'value', header: t('dh.value'), render: (row) => <code>{row.value}</code>, sortValue: (row) => row.value },
    { key: 'source', header: t('dh.seenIn'), render: (row) => SOURCE_LABEL[row.source] ?? row.source, sortValue: (row) => row.source, csv: (row) => SOURCE_LABEL[row.source] ?? row.source },
    { key: 'count', header: t('dh.count'), numeric: true, render: (row) => formatNumber(row.count), sortValue: (row) => row.count, bar: (row) => row.count },
    { key: 'first', header: t('dh.firstSeen'), render: (row) => <span className="num nowrap">{time(row.firstSeenAt)}</span>, sortValue: (row) => row.firstSeenAt },
    {
      key: 'channel',
      header: t('dh.mapTo'),
      render: (row) => <ResolveCell value={row} channels={channels} canEdit={canEdit} onDone={refresh} />,
      csv: (row) => row.resolvedChannelId ?? 'unmapped',
    },
  ];
  return (
    <section className="card stack" aria-labelledby="unmapped-heading">
      <div className="card__header">
        <div>
          <h2 id="unmapped-heading">{t('dh.unmapped')}</h2>
          <p className="muted">{t('dh.unmappedHint', { n: formatNumber(waiting) })}</p>
        </div>
        <label className="cluster cluster--nowrap">
          <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
          <span>{t('dh.showResolved')}</span>
        </label>
      </div>
      {accessProblem(taxonomy.error) ? (
        <p className="muted">{t('dh.unmappedNoAccess')}</p>
      ) : (
        <DataTable
          caption={t('dh.unmapped')}
          captionHidden
          columns={columns}
          rows={showResolved ? all : open}
          rowKey={(row) => row.id}
          loading={taxonomy.isPending}
          initialSort={{ key: 'count', direction: 'descending' }}
          exportFile="unmapped-values"
          pageSize={10}
          empty={t('dh.allMapped')}
        />
      )}
      {!canEdit && open.length > 0 && <p className="note">{t('dh.managerMaps')}</p>}
    </section>
  );
}

function ResolveCell({ value, channels, canEdit, onDone }: { value: UnmappedValue; channels: { id: string; name: string }[]; canEdit: boolean; onDone: () => void }) {
  const t = useT();
  const [channel, setChannel] = useState('');
  const resolve = useMutation({ mutationFn: () => resolveUnmapped(value.id, channel), onSuccess: onDone });
  if (value.resolvedChannelId) return <StatusBadge tone="success">{channels.find((item) => item.id === value.resolvedChannelId)?.name ?? value.resolvedChannelId}</StatusBadge>;
  if (!canEdit) return <StatusBadge tone="warning">{t('dh.needsChannel')}</StatusBadge>;
  return (
    <div className="cluster cluster--nowrap">
      <select className="select select--sm" aria-label={t('dh.channelFor', { value: value.value })} value={channel} onChange={(event) => setChannel(event.target.value)}>
        <option value="">{t('m.choose')}</option>
        {channels.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <Button size="sm" variant="secondary" disabled={!channel} loading={resolve.isPending} onClick={() => resolve.mutate()}>
        {t('dh.map')}
      </Button>
      {resolve.isError && <span className="field__error">{resolve.error.message}</span>}
    </div>
  );
}

/** Admin: pull a date range again, or rebuild the clean table from stored raw data (ANL-02). */
function RerunCard({ className, sources, onDone }: { className: string; sources: SourceHealth[]; onDone: () => void }) {
  const t = useT();
  const [rerun, setRerun] = useState({ source: '', from: monthAgo(), to: yerevanToday(), mode: 'pull' as 'pull' | 'rebuild' });
  const ranged = useMutation({ mutationFn: () => rerunSource(rerun.source, { from: rerun.from, to: rerun.to }, rerun.mode), onSuccess: onDone });
  return (
    <section className={`card stack ${className}`} aria-labelledby="rerun-heading">
      <div>
        <h2 id="rerun-heading">{t('dh.rerun')}</h2>
        <p className="muted">{t('dh.rerunHint')}</p>
      </div>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          ranged.mutate();
        }}
      >
        <SelectField
          label={t('dh.source')}
          required
          value={rerun.source}
          onChange={(event) => setRerun({ ...rerun, source: event.target.value })}
          options={[{ value: '', label: t('m.choose') }, ...sources.map((source) => ({ value: source.name, label: source.description }))]}
        />
        <div className="form-row">
          <TextField label={t('filter.from')} type="date" required value={rerun.from} max={rerun.to} onChange={(event) => setRerun({ ...rerun, from: event.target.value })} />
          <TextField label={t('filter.to')} type="date" required value={rerun.to} min={rerun.from} onChange={(event) => setRerun({ ...rerun, to: event.target.value })} />
        </div>
        <div className="segmented segmented--compact" role="group" aria-label={t('dh.rerunMode')}>
          <button type="button" className="segmented__btn" aria-pressed={rerun.mode === 'pull'} onClick={() => setRerun({ ...rerun, mode: 'pull' })}>
            {t('dh.pullAgain')}
          </button>
          <button type="button" className="segmented__btn" aria-pressed={rerun.mode === 'rebuild'} onClick={() => setRerun({ ...rerun, mode: 'rebuild' })}>
            {t('dh.rebuild')}
          </button>
        </div>
        <div className="cluster">
          <Button type="submit" variant="secondary" disabled={!rerun.source} loading={ranged.isPending}>
            {t('dh.rerunButton')}
          </Button>
          <span role="status" className="muted">
            {ranged.isSuccess ? t('dh.rowsSaved', { n: formatNumber(ranged.data.rowsUpserted) }) : ''}
          </span>
        </div>
        {ranged.isError && <Alert tone="danger" title={t('dh.rerunFailed')}>{ranged.error.message}</Alert>}
      </form>
    </section>
  );
}
