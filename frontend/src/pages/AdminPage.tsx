import { ArrowClockwise, ShieldCheck } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listExports, listJobs, runJob, type ExportLogRow, type JobStatus } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { STAFF_ROLES, useStaffRole } from '../lib/session';
import { AccessNotice, accessProblem, Alert, Button, DataTable, PageHeader, retryServerErrors, StatusBadge, type Column, type Tone } from '../ui';

const RUN_STATUS: Record<'running' | 'ok' | 'failed', { tone: Tone; label: string }> = {
  running: { tone: 'info', label: 'Running' },
  ok: { tone: 'success', label: 'OK' },
  failed: { tone: 'danger', label: 'Failed' },
};

const formatTime = (iso: string) => formatDate(iso, undefined, { timeStyle: 'short' });

/** PRD 4.3, shown so admins know what each role may do while roles live in the Core Engine. */
const CAPABILITIES: [string, string[]][] = [
  ['View dashboard and reports', ['viewer', 'editor', 'marketing_manager', 'admin', 'leadership']],
  ['View individual contact records', ['editor', 'marketing_manager', 'admin']],
  ['Export contacts (logged)', ['marketing_manager', 'admin']],
  ['Create and edit segments, edit newsletter drafts', ['editor', 'marketing_manager', 'admin']],
  ['Approve and send campaigns and newsletters', ['marketing_manager', 'admin']],
  ['Enter channel costs and budgets', ['marketing_manager', 'admin']],
  ['Change consent manually (with reason)', ['marketing_manager', 'admin']],
  ['Manage domains, keys, integrations, users', ['admin']],
];

function RunButton({ job, canRun }: { job: JobStatus; canRun: boolean }) {
  const queryClient = useQueryClient();
  const run = useMutation({ mutationFn: () => runJob(job.name), onSettled: () => void queryClient.invalidateQueries({ queryKey: ['jobs'] }) });
  if (!canRun) return null;
  return (
    <Button size="sm" variant="secondary" icon={<ArrowClockwise size={16} weight="bold" aria-hidden />} loading={run.isPending || job.running} onClick={() => run.mutate()}>
      Run now<span className="visually-hidden"> {job.description}</span>
    </Button>
  );
}

/** Admin (PRD 4.3, 14.4): roles come from the Core Engine; scheduled jobs with status and a re-run button. */
export function AdminPage() {
  const role = useStaffRole();
  const jobs = useQuery({ queryKey: ['jobs', role], queryFn: listJobs, retry: retryServerErrors, refetchInterval: 30_000 });
  const exportsLog = useQuery({ queryKey: ['exports', role], queryFn: listExports, retry: retryServerErrors });
  const access = accessProblem(jobs.error);
  const canRun = role === 'admin';

  const columns: Column<JobStatus>[] = [
    {
      key: 'job',
      header: 'Job',
      render: (job) => (
        <div className="stack stack--xs">
          <span>{job.description}</span>
          <code className="muted">{job.name}</code>
        </div>
      ),
    },
    { key: 'every', header: 'Every', render: (job) => (job.intervalMinutes > 0 ? `${job.intervalMinutes} min` : 'Manual') },
    {
      key: 'last',
      header: 'Last run',
      render: (job) =>
        job.lastRun ? (
          <div className="stack stack--xs">
            <StatusBadge tone={RUN_STATUS[job.lastRun.status].tone}>{RUN_STATUS[job.lastRun.status].label}</StatusBadge>
            <span className="muted num">
              {formatTime(job.lastRun.startedAt)} · {formatNumber(job.lastRun.rowsIn)} in, {formatNumber(job.lastRun.rowsUpserted)} saved
            </span>
            {job.lastRun.error && <span className="field__error">{job.lastRun.error}</span>}
          </div>
        ) : (
          <span className="muted">Never</span>
        ),
    },
    { key: 'success', header: 'Last success', render: (job) => (job.lastSuccessAt ? <span className="num">{formatTime(job.lastSuccessAt)}</span> : <span className="muted">None yet</span>) },
    { key: 'run', header: 'Action', render: (job) => <RunButton job={job} canRun={canRun} /> },
  ];

  return (
    <>
      <PageHeader
        title="Admin"
        accent="settings"
        description="Users and roles, integrations and scheduled jobs."
        actions={
          <a className="btn btn--ghost" href="#/design-system">
            Design system preview
          </a>
        }
      />
      <div className="stack stack--lg">
        <section className="card stack" aria-labelledby="roles-heading">
          <div className="cluster">
            <span className="icon-tile icon-tile--sm icon-tile--brand">
              <ShieldCheck size={20} weight="bold" aria-hidden />
            </span>
            <h2 id="roles-heading">Users and roles</h2>
          </div>
          <Alert tone="info" title="Users and roles are managed in the Academy Core Engine">
            Marketing Hub reads each person’s role from the Core Engine at sign-in and checks it on every request (NFR-S1).
            Until the Core Engine sign-in is connected, the role switch in the header stands in for it.
          </Alert>
          <div className="table-wrap" role="region" aria-label="What each role can do" tabIndex={0}>
            <table className="table">
              <caption className="visually-hidden">What each role can do (PRD 4.3)</caption>
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  {STAFF_ROLES.map((item) => (
                    <th key={item.value} scope="col">
                      {item.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CAPABILITIES.map(([capability, roles]) => (
                  <tr key={capability}>
                    <th scope="row">{capability}</th>
                    {STAFF_ROLES.map((item) => (
                      <td key={item.value}>{roles.includes(item.value) ? 'Yes' : <span className="muted">No</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card stack" aria-labelledby="jobs-heading">
          <h2 id="jobs-heading">Scheduled jobs</h2>
          <p className="muted">Sync with the Core Engine, Navigator CRM and Alumni Tracker. Every run is logged; failed runs keep their place and retry.</p>
          {access ? (
            <AccessNotice problem={access} title="Jobs are for admins and marketing managers">
              Ask an admin if you need to see integration status.
            </AccessNotice>
          ) : (
            <DataTable
              caption="Scheduled jobs"
              captionHidden
              columns={columns}
              rows={jobs.data?.jobs ?? []}
              rowKey={(job) => job.name}
              loading={jobs.isPending}
              error={jobs.isError ? jobs.error.message : undefined}
            />
          )}
        </section>
        {!access && exportsLog.data && (
          <section className="card stack" aria-labelledby="exports-heading">
            <h2 id="exports-heading">Export log</h2>
            <p className="muted">Every export of contact data: who, when, what and how many rows (AUD-19). Also written to the Core Engine activity log.</p>
            <DataTable
              caption="Export log"
              captionHidden
              columns={exportColumns}
              rows={exportsLog.data.exports}
              rowKey={(row) => row.id}
              empty="No exports yet."
            />
          </section>
        )}
      </div>
    </>
  );
}

const exportColumns: Column<ExportLogRow>[] = [
  { key: 'when', header: 'When', render: (row) => <span className="num">{formatTime(row.createdAt)}</span> },
  { key: 'who', header: 'Who', render: (row) => row.actorId },
  { key: 'what', header: 'What', render: (row) => (row.kind === 'segment_csv' ? `Segment “${row.segmentName ?? ''}” (CSV)` : 'One person’s data (access request)') },
  { key: 'rows', header: 'Rows', numeric: true, render: (row) => <span className="num">{formatNumber(row.rowCount)}</span> },
];
