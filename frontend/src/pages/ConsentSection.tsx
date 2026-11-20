import { ShieldCheck } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, changeConsent, getConsent, unsubscribeContact, type ConsentView, type Topic } from '../lib/api';
import { CONSENT, SUPPRESSION_LABEL, TOPIC_LABEL, options } from '../lib/contacts';
import { formatDate } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { Disclosure } from '../motion';
import { Alert, Button, Chip, ConfirmDialog, SkeletonCard, StatusBadge, TextField } from '../ui';

const formatTime = (iso: string) => formatDate(iso, undefined, { timeStyle: 'short' });

const METHOD_LABEL: Record<string, string> = {
  form: 'Website form',
  event: 'Event',
  import: 'Import',
  manual: 'Staff',
  link: 'Email link',
};

/** Manual change (6.3 rule 5): topics, new state and a reason that goes to the Core Engine activity log. */
function ManualChange({ contactId, onDone }: { contactId: string; onDone: (view: ConsentView) => void }) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [state, setState] = useState<'granted' | 'withdrawn'>('granted');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => changeConsent(contactId, { topics, state, reason }),
    onSuccess: (view) => {
      setTopics([]);
      setReason('');
      onDone(view);
    },
  });
  const error = save.error instanceof ApiError ? save.error : null;
  const toggle = (topic: Topic) => setTopics((current) => (current.includes(topic) ? current.filter((t) => t !== topic) : [...current, topic]));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="stack stack--sm">
        <span className="field__label" id="consent-topics-label">
          Topics
        </span>
        <div className="cluster" role="group" aria-labelledby="consent-topics-label">
          {options(TOPIC_LABEL).map(({ value, label }) => (
            <Chip key={value} selected={topics.includes(value)} onClick={() => toggle(value)}>
              {label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="stack stack--sm">
        <span className="field__label" id="consent-state-label">
          New state
        </span>
        <div className="segmented" role="group" aria-labelledby="consent-state-label">
          {(['granted', 'withdrawn'] as const).map((value) => (
            <button key={value} type="button" className="segmented__btn" aria-pressed={state === value} onClick={() => setState(value)}>
              {CONSENT[value].label}
            </button>
          ))}
        </div>
      </div>
      <TextField
        label="Reason"
        name="reason"
        required
        hint="Saved with the record and sent to the Core Engine activity log."
        value={reason}
        error={error?.details.field === 'reason' || error?.details.field === 'state' ? error.message : undefined}
        onChange={(event) => setReason(event.target.value)}
      />
      {error && !['reason', 'state'].includes(error.details.field ?? '') && (
        <Alert tone="danger" title="Consent was not changed">
          {error.message}
        </Alert>
      )}
      <div>
        <Button type="submit" variant="secondary" loading={save.isPending} disabled={topics.length === 0 || reason.trim() === ''}>
          Record change
        </Button>
      </div>
    </form>
  );
}

/** Consent per topic, suppression and history on the contact record (AUD-07, AUD-09, AUD-12). */
export function ConsentSection({ contactId, displayName }: { contactId: string; displayName: string }) {
  const role = useStaffRole();
  const canChange = role === 'admin' || role === 'marketing_manager';
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const key = ['consent', contactId, role];
  const consent = useQuery({ queryKey: key, queryFn: () => getConsent(contactId) });

  const refresh = (view: ConsentView) => {
    queryClient.setQueryData(key, view);
    void queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };
  const unsubscribe = useMutation({
    mutationFn: () => unsubscribeContact(contactId, reason),
    onSuccess: (view) => {
      setConfirm(false);
      setReason('');
      refresh(view);
    },
  });

  if (consent.isPending) return <SkeletonCard />;
  if (consent.isError) {
    return (
      <Alert tone="danger" title="Consent could not be loaded">
        {consent.error.message}
      </Alert>
    );
  }
  const data = consent.data;
  const suppressed = data.suppressed.length > 0;

  return (
    <section className="card stack" aria-labelledby="consent-heading">
      <div className="card__header">
        <div className="cluster">
          <span className="icon-tile icon-tile--sm icon-tile--brand">
            <ShieldCheck size={20} weight="bold" aria-hidden />
          </span>
          <h2 id="consent-heading">Consent</h2>
        </div>
        {canChange && !suppressed && (
          <Button variant="danger" size="sm" onClick={() => setConfirm(true)}>
            Unsubscribe from all
          </Button>
        )}
      </div>

      {suppressed && (
        <Alert tone="warning" title="On the suppression list: no marketing email is sent">
          {data.suppressed.map((row) => `${SUPPRESSION_LABEL[row.reason]} since ${formatTime(row.since)} (${row.source.replace('_', ' ')})`).join('; ')}.
          {' '}Staff and imports cannot lift it; only the person can opt in again.
        </Alert>
      )}

      <dl className="facts">
        {data.topics.map((topic) => (
          <div key={topic.topic}>
            <dt>{TOPIC_LABEL[topic.topic]}</dt>
            <dd>
              <StatusBadge tone={CONSENT[topic.state].tone}>{CONSENT[topic.state].label}</StatusBadge>
              {topic.since && (
                <span className="muted">
                  {METHOD_LABEL[topic.method ?? ''] ?? topic.method}, {formatDate(topic.since)}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {data.topics.some((topic) => topic.state === 'unknown') && (
        <p className="muted">Unknown consent: no marketing email on that topic until the person confirms (PRD 6.3).</p>
      )}

      {canChange && (
        <Disclosure title="Change consent manually">
          <ManualChange contactId={contactId} onDone={refresh} />
        </Disclosure>
      )}

      <Disclosure title={`Consent history (${data.history.length})`}>
        {data.history.length === 0 ? (
          <p className="muted">No consent recorded yet.</p>
        ) : (
          <ol className="list-reset history">
            {data.history.map((row) => (
              <li key={row.id} className="history__item">
                <span className="history__time num">{formatTime(row.at)}</span>
                <span>
                  <strong>{TOPIC_LABEL[row.topic]}</strong>: {CONSENT[row.state].label.toLowerCase()} · {METHOD_LABEL[row.method] ?? row.method}
                  {row.wordingVersion && (
                    <>
                      {' '}
                      · wording <code>{row.wordingVersion}</code>
                    </>
                  )}
                  {row.actorId && <> · by {row.actorId}</>}
                  {row.reason && <> · “{row.reason}”</>}
                  {row.sourceUrl && <> · {row.sourceUrl}</>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Disclosure>

      <ConfirmDialog
        open={confirm}
        title={`Unsubscribe ${displayName} from all marketing?`}
        confirmLabel="Unsubscribe from all"
        affected={{ count: 1, noun: 'contact' }}
        busy={unsubscribe.isPending}
        onConfirm={() => unsubscribe.mutate()}
        onCancel={() => setConfirm(false)}
      >
        <p>
          The address goes on the suppression list at once and every topic is withdrawn. Scheduled sends drop it.
          Only the person can opt in again.
        </p>
        <TextField label="Reason" name="unsubscribe-reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
        {unsubscribe.isError && (
          <Alert tone="danger" title="Could not unsubscribe">
            {unsubscribe.error.message}
          </Alert>
        )}
      </ConfirmDialog>
    </section>
  );
}
