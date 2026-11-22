import { ArrowClockwise, Check, Minus, ShieldCheck } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { listActivity, listExports, listJobs, runJob, type ActivityEvent, type ExportLogRow, type JobStatus } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { useT, type StringKey } from '../../lib/i18n';
import { STAFF_ROLES, useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, Button, DataTable, downloadCsv, PageHeader, retryServerErrors, SelectField, SkeletonTile, StatTile, StatusBadge, TabPanel, Tabs, tableCsv, type Column, type Tone } from '../../ui';
import { ExportCsvButton, useDateTimeLabel } from '../measure/shared';

type Tab = 'roles' | 'jobs' | 'activity' | 'exports';
const TABS: Tab[] = ['roles', 'jobs', 'activity', 'exports'];
const TAB_KEY: Record<Tab, StringKey> = { roles: 'ad.tab.roles', jobs: 'ad.tab.jobs', activity: 'ad.tab.activity', exports: 'ad.tab.exports' };

const RUN_TONE: Record<'running' | 'ok' | 'failed', Tone> = { running: 'info', ok: 'success', failed: 'danger' };

/** PRD 4.3, shown so admins know what each role may do while roles live in the Core Engine. */
const CAPABILITIES: [StringKey, string[]][] = [
  ['ad.cap.view', ['viewer', 'editor', 'marketing_manager', 'admin', 'leadership']],
  ['ad.cap.contacts', ['editor', 'marketing_manager', 'admin']],
  ['ad.cap.export', ['marketing_manager', 'admin']],
  ['ad.cap.segments', ['editor', 'marketing_manager', 'admin']],
  ['ad.cap.send', ['marketing_manager', 'admin']],
  ['ad.cap.costs', ['marketing_manager', 'admin']],
  ['ad.cap.consent', ['marketing_manager', 'admin']],
  ['ad.cap.admin', ['admin']],
];

/** "23:00" UTC → "03:00": Yerevan is UTC+4 all year. */
const yerevanTime = (utc: string) => {
  const [hours, minutes] = utc.split(':').map(Number) as [number, number];
  return `${String((hours + 4) % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

function RunButton({ job, canRun }: { job: JobStatus; canRun: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const run = useMutation({ mutationFn: () => runJob(job.name), onSettled: () => void queryClient.invalidateQueries({ queryKey: ['jobs'] }) });
  if (!canRun) return null;
  return (
    <Button size="sm" variant="secondary" icon={<ArrowClockwise size={16} weight="bold" aria-hidden />} loading={run.isPending || job.running} aria-label={t('ad.runNowFor', { job: job.description })} onClick={() => run.mutate()}>
      {t('ad.runNow')}
    </Button>
  );
}

/** Permission matrix: a text answer in every cell (icon plus Yes / No), the signed-in role's column marked. */
function RolesTab() {
  const t = useT();
  const current = useStaffRole();
  return (
    <section className="card stack" aria-labelledby="roles-heading">
      <div className="cluster">
        <span className="icon-tile icon-tile--sm icon-tile--brand">
          <ShieldCheck size={20} weight="bold" aria-hidden />
        </span>
        <h2 id="roles-heading">{t('ad.rolesTitle')}</h2>
      </div>
      <Alert tone="info" title={t('ad.rolesNote')}>
        {t('ad.rolesNoteBody')}
      </Alert>
      <div className="table-wrap" role="region" aria-label={t('ad.matrixCaption')} tabIndex={0}>
        <table className="table">
          <caption className="visually-hidden">{t('ad.matrixCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('ad.capability')}</th>
              {STAFF_ROLES.map((item) => (
                <th key={item.value} scope="col" className={item.value === current ? 'role-matrix__you' : undefined}>
                  {t(`role.${item.value}`)}
                  {item.value === current && <span className="muted text-xs"> ({t('ad.yourRole')})</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map(([capability, roles]) => (
              <tr key={capability}>
                <th scope="row">{t(capability)}</th>
                {STAFF_ROLES.map((item) => (
                  <td key={item.value} className={item.value === current ? 'role-matrix__you' : undefined}>
                    {roles.includes(item.value) ? (
                      <span className="yes-no yes-no--yes">
                        <Check size={16} weight="bold" aria-hidden />
                        {t('ad.yes')}
                      </span>
                    ) : (
                      <span className="yes-no yes-no--no">
                        <Minus size={16} weight="bold" aria-hidden />
                        {t('ad.no')}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function JobsTab({ jobs, canRun }: { jobs: ReturnType<typeof useJobs>; canRun: boolean }) {
  const t = useT();
  const dateTime = useDateTimeLabel();
  const access = accessProblem(jobs.error);
  const columns: Column<JobStatus>[] = [
    {
      key: 'job',
      header: t('ad.job'),
      render: (job) => (
        <div className="stack stack--xs">
          <span>{job.description}</span>
          <code className="muted">{job.name}</code>
        </div>
      ),
      sortValue: (job) => job.name,
      csv: (job) => job.name,
    },
    {
      key: 'every',
      header: t('ad.every'),
      render: (job) => (job.dailyAtUtc ? t('ad.everyNightly', { time: yerevanTime(job.dailyAtUtc) }) : job.intervalMinutes > 0 ? t('ad.everyMinutes', { n: job.intervalMinutes }) : t('ad.everyManual')),
    },
    {
      key: 'last',
      header: t('ad.lastRun'),
      render: (job) =>
        job.lastRun ? (
          <div className="stack stack--xs">
            <StatusBadge tone={RUN_TONE[job.lastRun.status]}>{t(`ad.run.${job.lastRun.status}`)}</StatusBadge>
            <span className="muted num">
              {dateTime(job.lastRun.startedAt)} · {t('ad.runRows', { in: formatNumber(job.lastRun.rowsIn), saved: formatNumber(job.lastRun.rowsUpserted) })}
            </span>
            {job.lastRun.error && <span className="field__error">{job.lastRun.error}</span>}
          </div>
        ) : (
          <span className="muted">{t('s.never')}</span>
        ),
      sortValue: (job) => job.lastRun?.startedAt ?? '',
      csv: (job) => job.lastRun?.status ?? '',
    },
    { key: 'success', header: t('ad.lastSuccess'), render: (job) => (job.lastSuccessAt ? <span className="num nowrap">{dateTime(job.lastSuccessAt)}</span> : <span className="muted">{t('s.noneYet')}</span>), sortValue: (job) => job.lastSuccessAt ?? '', csv: (job) => job.lastSuccessAt ?? '' },
    { key: 'run', header: t('m.actions'), render: (job) => <RunButton job={job} canRun={canRun} /> },
  ];
  return (
    <section className="card stack" aria-labelledby="jobs-heading">
      <h2 id="jobs-heading">{t('ad.jobsTitle')}</h2>
      <p className="muted">{t('ad.jobsHint')}</p>
      {access ? (
        <AccessNotice problem={access} title={t('ad.jobsAccess')}>
          {t('ad.jobsAccessHint')}
        </AccessNotice>
      ) : (
        <DataTable
          caption={t('ad.jobsTitle')}
          captionHidden
          columns={columns}
          rows={jobs.data?.jobs ?? []}
          rowKey={(job) => job.name}
          loading={jobs.isPending}
          error={jobs.isError ? jobs.error.message : undefined}
          initialSort={{ key: 'job', direction: 'ascending' }}
          exportFile="scheduled-jobs"
          pageSize={20}
        />
      )}
    </section>
  );
}

/** Details of an activity entry as `key: value` pairs; arrays are joined. Values never include personal data (server side). */
const detailsText = (details: Record<string, unknown>) =>
  Object.entries(details)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' · ');

function ActivityTab({ enabled }: { enabled: boolean }) {
  const t = useT();
  const role = useStaffRole();
  const dateTime = useDateTimeLabel();
  const [action, setAction] = useState('');
  const activity = useQuery({ queryKey: ['activity', role, action], queryFn: () => listActivity(action || undefined, 200), enabled, retry: retryServerErrors });
  const access = accessProblem(activity.error);
  const columns: Column<ActivityEvent>[] = [
    { key: 'when', header: t('ad.when'), render: (row) => <span className="num nowrap">{dateTime(row.at)}</span>, sortValue: (row) => row.at, csv: (row) => row.at },
    { key: 'who', header: t('ad.who'), render: (row) => row.who, sortValue: (row) => row.who },
    { key: 'action', header: t('ad.action'), render: (row) => <code>{row.action}</code>, sortValue: (row) => row.action, csv: (row) => row.action },
    { key: 'entity', header: t('ad.entity'), render: (row) => row.entity, sortValue: (row) => row.entity },
    { key: 'details', header: t('ad.details'), render: (row) => <code className="muted text-xs text-wrap">{detailsText(row.details)}</code>, csv: (row) => detailsText(row.details) },
  ];
  return (
    <section className="card stack" aria-labelledby="activity-heading">
      <div className="card__header">
        <div>
          <h2 id="activity-heading">{t('ad.activityTitle')}</h2>
          <p className="muted">{t('ad.activityHint', { n: 200 })}</p>
        </div>
        <div className="cluster no-print">
          <SelectField
            label={t('ad.actionFilter')}
            options={[{ value: '', label: t('ad.allActions') }, ...(activity.data?.actions ?? (action ? [action] : [])).map((value) => ({ value, label: value }))]}
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
          <ExportCsvButton disabled={!activity.data?.events.length} onExport={() => downloadCsv('activity-log', tableCsv(columns, activity.data?.events ?? []))} />
        </div>
      </div>
      {access ? (
        <AccessNotice problem={access} title={t('ad.jobsAccess')}>
          {t('ad.jobsAccessHint')}
        </AccessNotice>
      ) : (
        <DataTable
          caption={t('ad.activityTitle')}
          captionHidden
          columns={columns}
          rows={activity.data?.events ?? []}
          rowKey={(row) => row.id}
          loading={activity.isPending}
          error={activity.isError ? activity.error.message : undefined}
          pageSize={25}
          empty={t('ad.activityEmpty')}
        />
      )}
    </section>
  );
}

function ExportsTab({ exportsLog }: { exportsLog: ReturnType<typeof useExports> }) {
  const t = useT();
  const dateTime = useDateTimeLabel();
  const access = accessProblem(exportsLog.error);
  const columns: Column<ExportLogRow>[] = [
    { key: 'when', header: t('ad.when'), render: (row) => <span className="num nowrap">{dateTime(row.createdAt)}</span>, sortValue: (row) => row.createdAt, csv: (row) => row.createdAt },
    { key: 'who', header: t('ad.who'), render: (row) => row.actorId, sortValue: (row) => row.actorId },
    {
      key: 'what',
      header: t('ad.entity'),
      render: (row) => (row.kind === 'segment_csv' ? t('ad.exportSegment', { name: row.segmentName ?? '' }) : t('ad.exportPerson')),
      csv: (row) => (row.kind === 'segment_csv' ? t('ad.exportSegment', { name: row.segmentName ?? '' }) : t('ad.exportPerson')),
    },
    { key: 'rows', header: t('ad.rows'), numeric: true, render: (row) => <span className="num">{formatNumber(row.rowCount)}</span>, sortValue: (row) => row.rowCount, bar: (row) => row.rowCount },
  ];
  return (
    <section className="card stack" aria-labelledby="exports-heading">
      <h2 id="exports-heading">{t('ad.exportsTitle')}</h2>
      <p className="muted">{t('ad.exportsHint')}</p>
      {access ? (
        <AccessNotice problem={access} title={t('ad.jobsAccess')}>
          {t('ad.jobsAccessHint')}
        </AccessNotice>
      ) : (
        <DataTable
          caption={t('ad.exportsTitle')}
          captionHidden
          columns={columns}
          rows={exportsLog.data?.exports ?? []}
          rowKey={(row) => row.id}
          loading={exportsLog.isPending}
          initialSort={{ key: 'when', direction: 'descending' }}
          exportFile="export-log"
          pageSize={20}
          empty={t('ad.exportsEmpty')}
        />
      )}
    </section>
  );
}

function useJobs() {
  const role = useStaffRole();
  return useQuery({ queryKey: ['jobs', role], queryFn: listJobs, retry: retryServerErrors, refetchInterval: 30_000 });
}
function useExports() {
  const role = useStaffRole();
  return useQuery({ queryKey: ['exports', role], queryFn: listExports, retry: retryServerErrors });
}

/**
 * Admin (PRD 4.3, 14.4, AUD-19; RESTRUCTURE R5): the permission matrix, scheduled jobs with Run now, the activity
 * log with an action filter and the export log, behind tabs, with tiles for the state of the jobs and exports.
 */
export function AdminPage() {
  const t = useT();
  const role = useStaffRole();
  const idBase = useId();
  const [tab, setTab] = useState<Tab>('roles');
  const jobs = useJobs();
  const exportsLog = useExports();
  const canRun = role === 'admin';
  const list = jobs.data?.jobs ?? [];
  const ran = list.filter((job) => job.lastRun);
  const failing = ran.filter((job) => job.lastRun?.status === 'failed').length;
  const healthy = ran.filter((job) => job.lastRun?.status === 'ok').length;
  const monthAgo = Date.now() - 30 * 86_400_000;
  const recentExports = (exportsLog.data?.exports ?? []).filter((row) => new Date(row.createdAt).getTime() >= monthAgo);
  const exportedRows = recentExports.reduce((sum, row) => sum + row.rowCount, 0);
  const tilesReady = !jobs.isPending && !exportsLog.isPending;
  const noData = jobs.isError && exportsLog.isError;

  return (
    <>
      <PageHeader
        title={t('nav.admin')}
        description={t('ad.description')}
        actions={
          <a className="btn btn--ghost" href="#/design-system">
            {t('ad.designSystem')}
          </a>
        }
      />
      <div className="stack stack--lg">
        <div className="grid-12">
          {!tilesReady ? (
            [0, 1, 2, 3].map((i) => (
              <div key={i} className="span-3">
                <SkeletonTile />
              </div>
            ))
          ) : (
            <>
              <div className="span-3">
                <StatTile tone="yellow" label={t('ad.tileJobs')} value={noData ? '—' : formatNumber(list.length)} caption={t('ad.tileJobsCaption', { n: list.filter((job) => job.running).length })} definition={t('ad.tileJobsDefinition')} />
              </div>
              <div className="span-3">
                <StatTile label={t('ad.tileHealthy')} value={noData ? '—' : formatNumber(healthy)} caption={t('ad.tileHealthyCaption')} definition={t('ad.tileHealthyDefinition')} />
              </div>
              <div className="span-3">
                <StatTile label={t('ad.tileFailing')} value={noData ? '—' : formatNumber(failing)} caption={t('ad.tileFailingCaption')} definition={t('ad.tileFailingDefinition')} higherIsBetter={false} />
              </div>
              <div className="span-3">
                <StatTile label={t('ad.tileExports')} value={exportsLog.isError ? '—' : formatNumber(recentExports.length)} caption={t('ad.tileExportsCaption', { rows: formatNumber(exportedRows) })} definition={t('ad.tileExportsDefinition')} />
              </div>
            </>
          )}
        </div>
        <Tabs idBase={idBase} label={t('ad.tabs')} value={tab} onChange={setTab} tabs={TABS.map((id) => ({ id, label: t(TAB_KEY[id]) }))} />
        <TabPanel idBase={idBase} id={tab}>
          {tab === 'roles' && <RolesTab />}
          {tab === 'jobs' && <JobsTab jobs={jobs} canRun={canRun} />}
          {tab === 'activity' && <ActivityTab enabled />}
          {tab === 'exports' && <ExportsTab exportsLog={exportsLog} />}
        </TabPanel>
      </div>
    </>
  );
}
