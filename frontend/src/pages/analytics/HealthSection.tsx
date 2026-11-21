import { ArrowClockwise, FileArrowUp } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, getDataHealth, rerunSource, runJob, uploadAdSpendCsv, type SourceHealth } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, Button, DataTable, SelectField, SkeletonCard, StatusBadge, TextField, type Column, type Tone } from '../../ui';
import { yerevanToday } from './period';

const STATUS: Record<SourceHealth['status'], { tone: Tone; label: string }> = {
  ok: { tone: 'success', label: 'Fresh' },
  stale: { tone: 'warning', label: 'Stale' },
  failing: { tone: 'danger', label: 'Failing' },
  never_run: { tone: 'neutral', label: 'Not run yet' },
  running: { tone: 'info', label: 'Running' },
};
const SOURCE_LABEL: Record<string, string> = { website_analytics: 'Website analytics', website_form: 'Website form', navigator_crm: 'Navigator CRM' };
const time = (iso: string | null) => (iso ? formatDate(iso, undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const monthAgo = () => new Date(Date.now() + 4 * 3_600_000 - 30 * 86_400_000).toISOString().slice(0, 10);

/** Data Health (PRD 9.6, ANL-11) with the admin tools of the pipeline: re-run a range (ANL-02), CSV fallback (9.1). */
export function HealthSection() {
  const role = useStaffRole();
  const isAdmin = role === 'admin';
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ['data-health', role], queryFn: getDataHealth, refetchInterval: 60_000 });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['data-health'] });
  const run = useMutation({ mutationFn: (name: string) => runJob(name), onSuccess: refresh });
  const [rerun, setRerun] = useState({ source: '', from: monthAgo(), to: yerevanToday(), mode: 'pull' as 'pull' | 'rebuild' });
  const ranged = useMutation({ mutationFn: () => rerunSource(rerun.source, { from: rerun.from, to: rerun.to }, rerun.mode), onSuccess: refresh });
  const [upload, setUpload] = useState<{ platform: 'meta_ads' | 'google_ads'; file: File | null }>({ platform: 'meta_ads', file: null });
  const csv = useMutation({ mutationFn: async () => uploadAdSpendCsv(upload.platform, await (upload.file as File).text()), onSuccess: refresh });
  const csvError = csv.error instanceof ApiError ? csv.error : null;

  const access = accessProblem(health.error);
  if (access)
    return (
      <AccessNotice problem={access} title="Data Health is for admins and marketing managers">
        Admins manage integrations; marketing managers check that the numbers are fresh.
      </AccessNotice>
    );
  if (health.isPending) return <SkeletonCard />;
  if (health.isError) return <Alert tone="danger" title="Data Health not loaded">{health.error.message}</Alert>;
  const data = health.data;
  const failing = data.sources.filter((source) => source.status === 'failing');
  const external = data.sources.filter((source) => source.kind === 'external');

  const columns: Column<SourceHealth>[] = [
    {
      key: 'source',
      header: 'Source',
      render: (row) => (
        <div className="stack stack--xs">
          <span>{row.description}</span>
          <code className="muted">{row.name}</code>
        </div>
      ),
      sortValue: (row) => row.description,
    },
    { key: 'kind', header: 'Kind', render: (row) => (row.kind === 'external' ? 'External API' : 'Academy project') },
    { key: 'schedule', header: 'Schedule', render: (row) => row.schedule },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="stack stack--xs">
          <StatusBadge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</StatusBadge>
          {row.consecutiveFailures > 1 && <span className="field__error">{row.consecutiveFailures} failures in a row</span>}
        </div>
      ),
      sortValue: (row) => row.status,
    },
    { key: 'success', header: 'Last successful pull', render: (row) => <span className="num">{time(row.lastSuccessAt)}</span>, sortValue: (row) => row.lastSuccessAt ?? '' },
    {
      key: 'last',
      header: 'Last run',
      csv: (row) => (row.lastRun ? `${row.lastRun.startedAt} ${row.lastRun.status} ${row.lastRun.rowsIn} in ${row.lastRun.rowsUpserted} saved${row.lastRun.error ? ` ${row.lastRun.error}` : ''}` : ''),
      render: (row) =>
        row.lastRun ? (
          <div className="stack stack--xs">
            <span className="num">
              {time(row.lastRun.startedAt)} · {formatNumber(row.lastRun.rowsIn)} in, {formatNumber(row.lastRun.rowsUpserted)} saved
            </span>
            {row.lastRun.error && <span className="field__error">{row.lastRun.error}</span>}
          </div>
        ) : (
          '—'
        ),
    },
    ...(isAdmin
      ? [
          {
            key: 'run',
            header: 'Run',
            render: (row: SourceHealth) => (
              <Button size="sm" variant="ghost" icon={<ArrowClockwise size={16} aria-hidden />} loading={run.isPending && run.variables === row.name} onClick={() => run.mutate(row.name)}>
                Run now
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="stack stack--lg">
      {failing.length > 0 && (
        <Alert tone="danger" title={`${failing.length} source${failing.length > 1 ? 's' : ''} failing`}>
          Numbers that depend on {failing.map((source) => source.description).join(', ')} may be out of date. A source that fails twice in a row alerts the admins in Slack and by
          email.
        </Alert>
      )}
      <section className="card stack" aria-labelledby="sources-heading">
        <div className="card__header">
          <h2 id="sources-heading">Sources</h2>
          <span className="muted num">Checked {time(data.checkedAt)}</span>
        </div>
        <DataTable caption="Data sources" captionHidden columns={columns} rows={data.sources} rowKey={(row) => row.name} exportFile="data-health" />
      </section>

      <div className="grid grid--2">
        <section className="card stack" aria-labelledby="tables-heading">
          <h2 id="tables-heading">Clean tables</h2>
          <dl className="facts">
            <div>
              <dt>Website traffic rows</dt>
              <dd className="num">{formatNumber(data.tables.webTraffic)}</dd>
            </div>
            <div>
              <dt>Social metric rows</dt>
              <dd className="num">{formatNumber(data.tables.social)}</dd>
            </div>
            <div>
              <dt>Ad spend rows</dt>
              <dd className="num">{formatNumber(data.tables.adSpend)}</dd>
            </div>
          </dl>
          <p className="muted">Raw API responses are kept for 13 months, so any table can be rebuilt after a rule change.</p>
        </section>
        <section className="card stack" aria-labelledby="unmapped-count-heading">
          <h2 id="unmapped-count-heading">Unmapped values</h2>
          {data.unmapped.length === 0 ? (
            <p className="muted">Every value seen so far maps to a channel.</p>
          ) : (
            <ul className="list-reset stack stack--sm">
              {data.unmapped.map((item) => (
                <li key={item.source} className="cluster spread">
                  <span>{SOURCE_LABEL[item.source] ?? item.source}</span>
                  <StatusBadge tone="warning">{formatNumber(item.count)} to review</StatusBadge>
                </li>
              ))}
            </ul>
          )}
          <p>
            <a href="#/analytics/taxonomy">Review in Channel taxonomy</a>
          </p>
        </section>
      </div>

      {isAdmin && (
        <div className="grid grid--2">
          <section className="card stack" aria-labelledby="rerun-heading">
            <h2 id="rerun-heading">Re-run a date range</h2>
            <p className="muted">Pull again from the source, or rebuild the clean table from stored raw data. Re-runs never double-count.</p>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                ranged.mutate();
              }}
            >
              <SelectField
                label="Source"
                required
                value={rerun.source}
                onChange={(event) => setRerun({ ...rerun, source: event.target.value })}
                options={[{ value: '', label: 'Choose a source' }, ...external.map((source) => ({ value: source.name, label: source.description }))]}
              />
              <div className="form-row">
                <TextField label="From" type="date" required value={rerun.from} max={rerun.to} onChange={(event) => setRerun({ ...rerun, from: event.target.value })} />
                <TextField label="To" type="date" required value={rerun.to} min={rerun.from} onChange={(event) => setRerun({ ...rerun, to: event.target.value })} />
              </div>
              <div className="segmented" role="group" aria-label="How to re-run">
                <button type="button" className="segmented__btn" aria-pressed={rerun.mode === 'pull'} onClick={() => setRerun({ ...rerun, mode: 'pull' })}>
                  Pull again
                </button>
                <button type="button" className="segmented__btn" aria-pressed={rerun.mode === 'rebuild'} onClick={() => setRerun({ ...rerun, mode: 'rebuild' })}>
                  Rebuild from raw data
                </button>
              </div>
              <div className="cluster">
                <Button type="submit" variant="secondary" disabled={!rerun.source} loading={ranged.isPending}>
                  Re-run
                </Button>
                <span role="status" className="muted">
                  {ranged.isSuccess ? `${formatNumber(ranged.data.rowsUpserted)} rows saved.` : ''}
                </span>
              </div>
              {ranged.isError && <Alert tone="danger" title="Re-run failed">{ranged.error.message}</Alert>}
            </form>
          </section>

          <section className="card stack" aria-labelledby="csv-heading">
            <div className="cluster">
              <span className="icon-tile icon-tile--sm icon-tile--brand">
                <FileArrowUp size={20} weight="bold" aria-hidden />
              </span>
              <h2 id="csv-heading">Upload an ad platform export</h2>
            </div>
            <p className="muted">
              The fallback while an ad platform API is not connected. Columns: <code>date, campaign_id, campaign_name, spend, currency</code>; optional{' '}
              <code>utm_campaign, impressions, clicks, leads</code>. Nothing is saved unless every row is valid.
            </p>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                csv.mutate();
              }}
            >
              <SelectField
                label="Platform"
                value={upload.platform}
                onChange={(event) => setUpload({ ...upload, platform: event.target.value as 'meta_ads' | 'google_ads' })}
                options={[
                  { value: 'meta_ads', label: 'Meta Ads' },
                  { value: 'google_ads', label: 'Google Ads' },
                ]}
              />
              <TextField label="CSV file" type="file" accept=".csv,text/csv" required onChange={(event) => setUpload({ ...upload, file: event.target.files?.[0] ?? null })} />
              <div className="cluster">
                <Button type="submit" variant="secondary" disabled={!upload.file} loading={csv.isPending}>
                  Upload
                </Button>
                <span role="status" className="muted">
                  {csv.isSuccess ? `${formatNumber(csv.data.rowsUpserted)} rows saved${csv.data.range ? `, ${csv.data.range.from} to ${csv.data.range.to}` : ''}.` : ''}
                </span>
              </div>
              {csv.isError && (
                <Alert tone="danger" title="File not imported">
                  {csv.error.message}
                  {csvError?.details.rows && (
                    <ul className="list-reset">
                      {csvError.details.rows.slice(0, 10).map((row) => (
                        <li key={`${row.line}-${row.message}`}>
                          Line {row.line}: {row.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </Alert>
              )}
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
