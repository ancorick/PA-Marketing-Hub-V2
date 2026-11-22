import { ArrowLeft, PaperPlaneTilt } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ApiError,
  approveSend,
  cancelSend,
  createSend,
  deleteSend,
  getSend,
  listSegments,
  listSends,
  pauseSend,
  previewSend,
  resumeSend,
  segmentBreakdown,
  sendChecks,
  sendLog,
  sendReport,
  testSend,
  updateSend,
  type DeliveryLogRow,
  type Language,
  type Send,
  type SendInput,
  type SendStatus,
  type Topic,
} from '../lib/api';
import { contactPath, LANGUAGE_LABEL, options, TOPIC_LABEL } from '../lib/contacts';
import { formatDate, formatNumber } from '../lib/format';
import { useStaffRole } from '../lib/session';
import {
  AccessNotice,
  accessProblem,
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  PageHeader,
  retryServerErrors,
  SelectField,
  SkeletonCard,
  StatTile,
  StatusBadge,
  TextField,
  type Column,
  type Tone,
} from '../ui';
import { EmailPreview } from './EmailPreview';
import { KillSwitchBanner } from './KillSwitch';

export const SEND_STATUS: Record<SendStatus, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  approved: { tone: 'info', label: 'Approved' },
  scheduled: { tone: 'info', label: 'Scheduled' },
  sending: { tone: 'warning', label: 'Sending' },
  paused: { tone: 'warning', label: 'Paused' },
  sent: { tone: 'success', label: 'Sent' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

const formatTime = (iso: string) => formatDate(iso, undefined, { timeStyle: 'short' });

const EMPTY: SendInput = {
  name: '',
  topic: 'courses',
  purpose: 'recruitment',
  includeActiveAdmissions: false,
  segmentId: null,
  language: 'hy',
  fromName: 'Picsart Academy',
  fromAddress: '',
  subject: '',
  preheader: null,
  body: '',
  buttonLabel: null,
  buttonUrl: null,
};

const toInput = (send: Send): SendInput => ({
  name: send.name,
  topic: send.topic,
  purpose: send.purpose,
  includeActiveAdmissions: send.includeActiveAdmissions,
  segmentId: send.segmentId,
  language: send.language,
  fromName: send.fromName,
  fromAddress: send.fromAddress,
  subject: send.subject,
  preheader: send.preheader,
  body: send.body,
  buttonLabel: send.buttonLabel,
  buttonUrl: send.buttonUrl,
});

const CHECK_TONE: Record<'pass' | 'warn' | 'fail', Tone> = { pass: 'success', warn: 'warning', fail: 'danger' };

function Preview({ sendId, version }: { sendId: string; version: string }) {
  return <EmailPreview queryKey={['send-preview', sendId, version]} load={() => previewSend(sendId)} />;
}

function Checks({ sendId, version }: { sendId: string; version: string }) {
  const checks = useQuery({ queryKey: ['send-checks', sendId, version], queryFn: () => sendChecks(sendId) });
  return (
    <section className="card stack" aria-labelledby="checks-heading">
      <div className="card__header">
        <h2 id="checks-heading">Pre-send checks</h2>
        <Button size="sm" variant="secondary" loading={checks.isFetching} onClick={() => void checks.refetch()}>
          Run again
        </Button>
      </div>
      <ul className="list-reset stack stack--sm">
        {checks.data?.checks.map((check) => (
          <li key={check.id} className="cluster check-row">
            <StatusBadge tone={CHECK_TONE[check.status]}>{check.label}</StatusBadge>
            <span className="muted">{check.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SendResults({ send }: { send: Send }) {
  const [offset, setOffset] = useState(0);
  const report = useQuery({ queryKey: ['send-report', send.id, send.updatedAt], queryFn: () => sendReport(send.id), refetchInterval: send.status === 'sending' ? 10_000 : false });
  const log = useQuery({ queryKey: ['send-log', send.id, offset, send.updatedAt], queryFn: () => sendLog(send.id, offset) });
  const by = report.data?.byStatus ?? {};
  const delivered = (by.sent ?? 0) + (by.delivered ?? 0);
  const columns: Column<DeliveryLogRow>[] = [
    { key: 'who', header: 'Contact', render: (row) => (row.contactId ? <a href={contactPath(row.contactId)}>{row.name ?? row.email}</a> : (row.email ?? 'Removed contact')) },
    { key: 'status', header: 'Status', render: (row) => `${row.status}${row.skipReason ? ` (${row.skipReason})` : ''}` },
    { key: 'time', header: 'Sent', render: (row) => (row.sentAt ? <span className="num">{formatTime(row.sentAt)}</span> : '') },
    { key: 'esp', header: 'ESP message ID', render: (row) => (row.espMessageId ? <code>{row.espMessageId}</code> : row.lastError ? <span className="field__error">{row.lastError}</span> : '') },
  ];
  return (
    <section className="card stack" aria-labelledby="results-heading">
      <h2 id="results-heading">Results</h2>
      <div className="tiles">
        <StatTile label="Sent" value={formatNumber(delivered)} definition="Messages accepted by the email service for this campaign." />
        <StatTile label="Skipped" value={formatNumber(by.skipped ?? 0)} definition="Unsubscribed, without consent or over their monthly limit when their turn came." />
        <StatTile label="Clicked" value={formatNumber(report.data?.clicked ?? 0)} definition="People who clicked at least one link (from ESP webhooks)." />
        <StatTile label="Opened (estimated)" value={formatNumber(report.data?.openedEstimated ?? 0)} definition="Opens are unreliable: image blocking hides some, privacy proxies add others (PRD 7.5)." />
      </div>
      <DataTable caption="Send log (EML-16)" columns={columns} rows={log.data?.deliveries ?? []} rowKey={(row) => row.id} loading={log.isPending} empty="Nothing sent yet." />
      {log.data && log.data.total > 50 && (
        <div className="cluster spread">
          <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
            Previous
          </Button>
          <Button size="sm" variant="secondary" disabled={offset + 50 >= log.data.total} onClick={() => setOffset(offset + 50)}>
            Next
          </Button>
        </div>
      )}
    </section>
  );
}

/** Campaign editor: content, preview, checks, test send, approval, then results (Flow B). */
export function CampaignPage({ id }: { id: string | null }) {
  const role = useStaffRole();
  const canApprove = role === 'admin' || role === 'marketing_manager';
  const queryClient = useQueryClient();
  const send = useQuery({ queryKey: ['send', id, role], queryFn: () => getSend(id!), enabled: id !== null, retry: retryServerErrors });
  const segments = useQuery({ queryKey: ['segments', role], queryFn: listSegments, retry: retryServerErrors });
  const seeds = useQuery({ queryKey: ['sends', role], queryFn: listSends, retry: retryServerErrors });
  const [draft, setDraft] = useState<SendInput | null>(null);
  const [testEmails, setTestEmails] = useState('');
  const [approving, setApproving] = useState(false);
  const [when, setWhen] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  const current = send.data;
  const values = draft ?? (current ? toInput(current) : EMPTY);
  const editable = !current || current.status === 'draft' || current.status === 'approved';
  const set = <K extends keyof SendInput>(key: K, value: SendInput[K]) => setDraft({ ...values, [key]: value });
  const refresh = (saved: Send) => {
    queryClient.setQueryData(['send', saved.id, role], saved);
    void queryClient.invalidateQueries({ queryKey: ['sends'] });
  };

  const save = useMutation({
    mutationFn: () => (current ? updateSend(current.id, values) : createSend(values)),
    onSuccess: (saved) => {
      setDraft(null);
      refresh(saved);
      if (!current) window.location.hash = `#/campaign-emails/${saved.id}`;
    },
  });
  const test = useMutation({ mutationFn: () => testSend(current!.id, testEmails.split(/[\s,;]+/).filter(Boolean)) });
  const breakdown = useQuery({
    queryKey: ['send-breakdown', current?.id, current?.updatedAt],
    queryFn: () => segmentBreakdown(current!.segmentId!, current!.topic, current!.purpose === 'recruitment' && !current!.includeActiveAdmissions),
    enabled: approving && Boolean(current?.segmentId),
  });
  const approve = useMutation({
    mutationFn: () => approveSend(current!.id, when ? new Date(when).toISOString() : null),
    onSuccess: (saved) => {
      setApproving(false);
      refresh(saved);
    },
  });
  const pause = useMutation({ mutationFn: () => pauseSend(current!.id, 'Paused by a marketing manager'), onSuccess: refresh });
  const resume = useMutation({ mutationFn: () => resumeSend(current!.id), onSuccess: refresh });
  const cancel = useMutation({
    mutationFn: () => cancelSend(current!.id),
    onSuccess: (saved) => {
      setConfirmCancel(false);
      refresh(saved);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteSend(current!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sends'] });
      window.location.hash = '#/campaign-emails';
    },
  });

  const access = accessProblem(send.error ?? segments.error);
  const back = (
    <a className="back-link" href="#/campaign-emails">
      <ArrowLeft size={16} weight="bold" aria-hidden />
      All campaigns
    </a>
  );
  if (access) {
    return (
      <>
        {back}
        <AccessNotice problem={access} title="Campaigns are for editors, marketing managers and admins">
          Your role sees aggregate numbers only (PRD 4.3).
        </AccessNotice>
      </>
    );
  }
  if (id !== null && send.isPending) return <SkeletonCard />;
  if (id !== null && !current) return <>{back}<Alert tone="danger" title="Campaign not found" /></>;

  const error = save.error instanceof ApiError ? save.error : null;
  const fieldError = (name: string) => (error?.details.field === name ? error.message : undefined);
  const version = current?.updatedAt ?? 'new';

  return (
    <>
      {back}
      <PageHeader
        title={current ? current.name : 'New'}
        accent={current ? undefined : 'campaign'}
        description={current ? `${SEND_STATUS[current.status].label}${current.pausedReason ? `: ${current.pausedReason}` : ''}` : 'Write it, check it, test it, then ask a marketing manager to approve.'}
        actions={
          current && (
            <div className="cluster">
              {current.status === 'draft' && (
                <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
                  Delete draft
                </Button>
              )}
              {canApprove && ['scheduled', 'sending'].includes(current.status) && (
                <Button variant="secondary" loading={pause.isPending} onClick={() => pause.mutate()}>
                  Pause
                </Button>
              )}
              {canApprove && current.status === 'paused' && (
                <Button variant="secondary" loading={resume.isPending} onClick={() => resume.mutate()}>
                  Resume
                </Button>
              )}
              {canApprove && !['sent', 'cancelled'].includes(current.status) && (
                <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                  Cancel send
                </Button>
              )}
              {canApprove && editable && (
                <Button variant="primary" icon={<PaperPlaneTilt size={18} weight="bold" aria-hidden />} disabled={draft !== null} onClick={() => setApproving(true)}>
                  Approve and schedule
                </Button>
              )}
            </div>
          )
        }
      />
      <div className="stack stack--lg">
        <KillSwitchBanner />
        {current && !editable && <Alert tone="info" title={`This campaign is ${SEND_STATUS[current.status].label.toLowerCase()}; its content is locked.`} />}
        <section className="card stack" aria-labelledby="content-heading">
          <h2 id="content-heading">Content</h2>
          <fieldset className="fieldset" disabled={!editable}>
            <legend className="fieldset__legend">Audience</legend>
            <div className="form-row">
              <TextField label="Campaign name" required value={values.name} error={fieldError('name')} onChange={(e) => set('name', e.target.value)} />
              <SelectField
                label="Segment"
                required
                options={[{ value: '', label: 'Choose a segment' }, ...(segments.data?.segments.map((s) => ({ value: s.id, label: `${s.name} (${s.lastCount ?? 0})` })) ?? [])]}
                value={values.segmentId ?? ''}
                onChange={(e) => set('segmentId', e.target.value || null)}
              />
              <SelectField label="Consent topic" hint="Only people who agreed to this topic receive it." options={options(TOPIC_LABEL)} value={values.topic} onChange={(e) => set('topic', e.target.value as Topic)} />
              <SelectField label="Language" options={options(LANGUAGE_LABEL)} value={values.language} onChange={(e) => set('language', e.target.value as Language)} />
              <SelectField
                label="Purpose"
                options={[{ value: 'recruitment', label: 'Recruitment (new students)' }, { value: 'other', label: 'Other news' }]}
                value={values.purpose}
                onChange={(e) => set('purpose', e.target.value as SendInput['purpose'])}
              />
              {values.purpose === 'recruitment' && (
                <label className="check">
                  <input type="checkbox" checked={values.includeActiveAdmissions} onChange={(e) => set('includeActiveAdmissions', e.target.checked)} />
                  <span>Include people in an active admissions stage (left out by default, AUD-17)</span>
                </label>
              )}
            </div>
          </fieldset>
          <fieldset className="fieldset" disabled={!editable}>
            <legend className="fieldset__legend">Message</legend>
            <div className="form-row">
              <TextField label="From name" required value={values.fromName} onChange={(e) => set('fromName', e.target.value)} />
              <TextField label="From address" required placeholder="news@news.academy-domain.am" hint="On a verified sending domain." value={values.fromAddress} error={fieldError('fromAddress')} onChange={(e) => set('fromAddress', e.target.value)} />
              <TextField label="Subject" required hint="{{first_name}} inserts the first name." value={values.subject} onChange={(e) => set('subject', e.target.value)} />
              <TextField label="Preview text" hint="Shown after the subject in the inbox." value={values.preheader ?? ''} onChange={(e) => set('preheader', e.target.value || null)} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="campaign-body">
                Body<span className="field__required" aria-hidden>*</span>
              </label>
              <textarea
                id="campaign-body"
                className="input textarea"
                rows={10}
                value={values.body}
                aria-describedby="campaign-body-hint"
                aria-invalid={fieldError('body') ? true : undefined}
                onChange={(e) => set('body', e.target.value)}
              />
              <span id="campaign-body-hint" className="field__hint">
                Blank line = new paragraph. **bold**, [link text](https://…), ![image description](https://…). Every link gets campaign tags automatically.
              </span>
              {fieldError('body') && <span className="field__error">{fieldError('body')}</span>}
            </div>
            <div className="form-row">
              <TextField label="Button text" value={values.buttonLabel ?? ''} onChange={(e) => set('buttonLabel', e.target.value || null)} />
              <TextField label="Button link" placeholder="https://…" value={values.buttonUrl ?? ''} error={fieldError('buttonUrl')} onChange={(e) => set('buttonUrl', e.target.value || null)} />
            </div>
          </fieldset>
          {error && !error.details.field && <Alert tone="danger" title="Could not save">{error.message}</Alert>}
          {editable && (
            <div className="cluster">
              <Button variant={current ? 'secondary' : 'primary'} loading={save.isPending} disabled={!values.name || !values.subject || !values.body || !values.fromAddress} onClick={() => save.mutate()}>
                {current ? 'Save changes' : 'Save draft'}
              </Button>
              {current?.status === 'approved' && draft && <span className="muted">Saving sends it back to draft for approval.</span>}
            </div>
          )}
        </section>

        {current && (
          <>
            <div className="grid grid--2">
              <Preview sendId={current.id} version={version} />
              <div className="stack stack--lg">
                <Checks sendId={current.id} version={version} />
                <section className="card stack" aria-labelledby="test-heading">
                  <h2 id="test-heading">Test send</h2>
                  <TextField
                    label="Send a test to"
                    hint={seeds.data?.seedList.length ? `Empty: the seed list (${seeds.data.seedList.join(', ')}).` : 'Emails separated by commas.'}
                    value={testEmails}
                    onChange={(e) => setTestEmails(e.target.value)}
                  />
                  <div className="cluster">
                    <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
                      Send test
                    </Button>
                    <span role="status" className="muted">
                      {test.isSuccess ? `Sent to ${test.data.sent} inboxes, marked [Test].` : test.isError ? test.error.message : ''}
                    </span>
                  </div>
                </section>
              </div>
            </div>
            {['sending', 'sent', 'paused', 'cancelled'].includes(current.status) && <SendResults send={current} />}
          </>
        )}
      </div>

      <ConfirmDialog
        open={approving}
        title={`Approve “${current?.name ?? ''}”?`}
        confirmLabel={when ? 'Approve and schedule' : 'Approve and send now'}
        tone="primary"
        affected={breakdown.data ? { count: breakdown.data.eligible, noun: 'people receive it' } : undefined}
        busy={approve.isPending}
        onConfirm={() => approve.mutate()}
        onCancel={() => setApproving(false)}
      >
        {breakdown.data && (
          <p>
            Of {formatNumber(breakdown.data.matching)} in the segment, {formatNumber(breakdown.data.notReachable)} are unsubscribed or bounced,{' '}
            {formatNumber(breakdown.data.noConsent)} have not agreed to this topic and {formatNumber(breakdown.data.activeAdmissions)} are talking to
            admissions. The audience is counted again at send time.
          </p>
        )}
        <TextField label="Send at" type="datetime-local" hint="Empty: send now." value={when} onChange={(e) => setWhen(e.target.value)} />
        {approve.isError && <Alert tone="danger" title="Not approved">{approve.error.message}</Alert>}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmCancel}
        title={`Cancel “${current?.name ?? ''}”?`}
        confirmLabel="Cancel send"
        affected={{ count: current?.sentCount ?? 0, noun: 'already sent (they keep their email)' }}
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setConfirmCancel(false)}
      >
        <p>Nobody else receives it. This cannot be undone. To stop for a while instead, use Pause.</p>
      </ConfirmDialog>
    </>
  );
}
