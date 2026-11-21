import { CheckCircle, PaperPlaneTilt } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  addIssueComment,
  approveIssue,
  issueChecks,
  issueComments,
  issuePreview,
  issueTestSend,
  requestIssueChanges,
  submitIssue,
  unscheduleIssue,
  type Issue,
  type IssueComment,
} from '../lib/api';
import { formatDate } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { Alert, Button, ConfirmDialog, StatusBadge, TextField, type Tone } from '../ui';
import { EmailPreview } from './EmailPreview';

const CHECK_TONE: Record<'pass' | 'warn' | 'fail', Tone> = { pass: 'success', warn: 'warning', fail: 'danger' };
const COMMENT_LABEL: Record<IssueComment['kind'], string> = {
  comment: 'Comment',
  submitted: 'Submitted for approval',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  unscheduled: 'Taken off the schedule',
};
const formatTime = (iso: string) => formatDate(iso, undefined, { timeStyle: 'short' });

/** NWS-08 to NWS-11: checks, preview, test send, the approval thread and scheduling of one issue. */
export function IssueReview({ issue }: { issue: Issue }) {
  const role = useStaffRole();
  const isManager = role === 'admin' || role === 'marketing_manager';
  const queryClient = useQueryClient();
  const version = issue.updatedAt;
  const checks = useQuery({ queryKey: ['issue-checks', issue.id, version], queryFn: () => issueChecks(issue.id) });
  const comments = useQuery({ queryKey: ['issue-comments', issue.id, version], queryFn: () => issueComments(issue.id) });
  const [testTo, setTestTo] = useState('');
  const [comment, setComment] = useState('');
  const [approving, setApproving] = useState(false);
  const [when, setWhen] = useState('');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['issue', issue.id] });
    void queryClient.invalidateQueries({ queryKey: ['issue-comments', issue.id] });
    void queryClient.invalidateQueries({ queryKey: ['issues'] });
  };
  const after = () => {
    setComment('');
    refresh();
  };
  const test = useMutation({ mutationFn: () => issueTestSend(issue.id, testTo.split(/[\s,;]+/).filter(Boolean)) });
  const submit = useMutation({ mutationFn: () => submitIssue(issue.id, comment || null), onSuccess: after });
  const changes = useMutation({ mutationFn: () => requestIssueChanges(issue.id, comment), onSuccess: after });
  const note = useMutation({ mutationFn: () => addIssueComment(issue.id, comment), onSuccess: after });
  const unschedule = useMutation({ mutationFn: () => unscheduleIssue(issue.id), onSuccess: refresh });
  const approve = useMutation({
    mutationFn: () => approveIssue(issue.id, comment || null, when ? new Date(when).toISOString() : null),
    onSuccess: () => {
      setApproving(false);
      after();
    },
  });
  const failing = checks.data?.checks.filter((check) => check.status === 'fail') ?? [];
  const error = submit.error ?? changes.error ?? note.error ?? unschedule.error;

  return (
    <div className="stack stack--lg">
      <div className="grid grid--2">
        <EmailPreview queryKey={['issue-preview', issue.id, version]} load={() => issuePreview(issue.id)} />
        <div className="stack stack--lg">
          <section className="card stack" aria-labelledby="issue-checks-heading">
            <div className="card__header">
              <h2 id="issue-checks-heading">Pre-send checks</h2>
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
          <section className="card stack" aria-labelledby="issue-test-heading">
            <h2 id="issue-test-heading">Test send</h2>
            <TextField label="Send a test to" hint="Empty: the seed list (SEED_LIST)." value={testTo} onChange={(e) => setTestTo(e.target.value)} />
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

      <section className="card stack" aria-labelledby="approval-heading">
        <div className="cluster">
          <span className="icon-tile icon-tile--sm icon-tile--brand">
            <CheckCircle size={20} weight="bold" aria-hidden />
          </span>
          <h2 id="approval-heading">Approval</h2>
        </div>
        <ol className="list-reset history">
          {(comments.data?.comments ?? []).map((item) => (
            <li key={item.id} className="history__item">
              <span className="history__time num">{formatTime(item.createdAt)}</span>
              <span>
                <strong>{COMMENT_LABEL[item.kind]}</strong> · {item.actorId}
                {item.body && <span className="block-body"> · {item.body}</span>}
              </span>
            </li>
          ))}
        </ol>
        {issue.status !== 'sent' && (
          <>
            <TextField label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="cluster">
              {issue.status === 'draft' && (
                <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate()}>
                  Submit for approval
                </Button>
              )}
              {isManager && ['draft', 'in_review'].includes(issue.status) && (
                <Button variant={issue.status === 'in_review' ? 'primary' : 'secondary'} icon={<PaperPlaneTilt size={18} weight="bold" aria-hidden />} disabled={failing.length > 0} onClick={() => setApproving(true)}>
                  Approve and schedule
                </Button>
              )}
              {isManager && issue.status === 'in_review' && (
                <Button variant="secondary" loading={changes.isPending} disabled={!comment.trim()} onClick={() => changes.mutate()}>
                  Request changes
                </Button>
              )}
              {isManager && issue.status === 'scheduled' && (
                <Button variant="secondary" loading={unschedule.isPending} onClick={() => unschedule.mutate()}>
                  Take off the schedule
                </Button>
              )}
              <Button variant="ghost" loading={note.isPending} disabled={!comment.trim()} onClick={() => note.mutate()}>
                Add comment
              </Button>
            </div>
            {failing.length > 0 && isManager && <p className="muted">Approval opens once these pass: {failing.map((check) => check.label).join(', ')}.</p>}
            {issue.status === 'scheduled' && <Alert tone="info" title="Scheduled">The approved version is locked. Take it off the schedule to change anything; it then needs approval again.</Alert>}
          </>
        )}
        {error && <Alert tone="danger" title="Not done">{error.message}</Alert>}
      </section>

      <ConfirmDialog
        open={approving}
        title="Approve and schedule this issue?"
        confirmLabel={when ? 'Approve and schedule' : 'Approve for the planned date'}
        tone="primary"
        busy={approve.isPending}
        onConfirm={() => approve.mutate()}
        onCancel={() => setApproving(false)}
      >
        <p>
          The blocks as they are now go out to the {issue.language} newsletter segment, only to people with newsletter consent and not
          suppressed. Planned for {formatTime(issue.plannedSendAt)}.
        </p>
        <TextField label="Send at instead" type="datetime-local" hint="Empty: the planned date (or now, if it has passed)." value={when} onChange={(e) => setWhen(e.target.value)} />
        {approve.isError && <Alert tone="danger" title="Not approved">{approve.error.message}</Alert>}
      </ConfirmDialog>
    </div>
  );
}
