import { ArrowLeft, UsersThree } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { dismissDuplicate, listDuplicates, mergeContacts, type ContactDetail, type DuplicateReason } from '../lib/api';
import { contactPath, DUPLICATE_REASON, fullName, LANGUAGE_LABEL, STATUS, TYPE_LABEL } from '../lib/contacts';
import { formatDate } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { AccessNotice, accessProblem, Alert, Button, ConfirmDialog, EmptyState, PageHeader, retryServerErrors, SkeletonCard, StatusBadge } from '../ui';

const label = (contact: ContactDetail) => fullName(contact) ?? contact.email ?? 'Contact';

function Side({ contact }: { contact: ContactDetail }) {
  return (
    <div className="inset">
      <a href={contactPath(contact.id)}>
        <strong>{label(contact)}</strong>
      </a>
      <dl className="facts facts--compact">
        <div>
          <dt>Email</dt>
          <dd>{contact.email}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{contact.phone ?? <span className="muted">None</span>}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>
            {TYPE_LABEL[contact.type]} · {LANGUAGE_LABEL[contact.language]}
          </dd>
        </div>
        <div>
          <dt>First touch</dt>
          <dd className="num">{formatDate(contact.firstTouchAt)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <StatusBadge tone={STATUS[contact.status].tone}>{STATUS[contact.status].label}</StatusBadge>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** One suggested pair: merge either way, or mark as different people (AUD-04, AUD-05). */
export function DuplicatePair({ reason, a, b, onDone }: { reason: DuplicateReason; a: ContactDetail; b: ContactDetail; onDone: () => void }) {
  const [keep, setKeep] = useState<ContactDetail | null>(null);
  const other = keep === a ? b : a;
  const merge = useMutation({
    mutationFn: () => mergeContacts(keep!.id, other.id),
    onSuccess: () => {
      setKeep(null);
      onDone();
    },
  });
  const dismiss = useMutation({ mutationFn: () => dismissDuplicate(a.id, b.id), onSuccess: onDone });

  return (
    <section className="card stack" aria-label={`Possible duplicate: ${label(a)} and ${label(b)}`}>
      <p className="eyebrow">{DUPLICATE_REASON[reason]}</p>
      <div className="grid grid--2">
        <Side contact={a} />
        <Side contact={b} />
      </div>
      <div className="cluster">
        <Button variant="secondary" size="sm" onClick={() => setKeep(a)}>
          Keep {label(a)}, merge the other in
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setKeep(b)}>
          Keep {label(b)}, merge the other in
        </Button>
        <Button variant="ghost" size="sm" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>
          Not the same person
        </Button>
      </div>
      {dismiss.isError && <Alert tone="danger" title="Could not save">{dismiss.error.message}</Alert>}
      <ConfirmDialog
        open={keep !== null}
        title={`Merge ${label(other)} into ${keep ? label(keep) : ''}?`}
        confirmLabel="Merge contacts"
        affected={{ count: 2, noun: 'contact records' }}
        busy={merge.isPending}
        onConfirm={() => merge.mutate()}
        onCancel={() => setKeep(null)}
      >
        <p>
          One record stays: {keep?.email}. It keeps the earliest first touch with its source, all touches and consent
          history, both sets of tags and, per topic, the most restrictive consent. {other.email} is removed and cannot be
          restored.
        </p>
        {merge.isError && (
          <Alert tone="danger" title="Could not merge">
            {merge.error.message}
          </Alert>
        )}
      </ConfirmDialog>
    </section>
  );
}

/** Audience → Duplicates: suggested merges for review (AUD-04, AUD-05). */
export function DuplicatesPage() {
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const pairs = useQuery({ queryKey: ['duplicates', role], queryFn: listDuplicates, retry: retryServerErrors });
  const access = accessProblem(pairs.error);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['duplicates'] });
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };

  return (
    <>
      <a className="back-link" href="#/contacts">
        <ArrowLeft size={16} weight="bold" aria-hidden />
        All contacts
      </a>
      <PageHeader title="Possible" accent="duplicates" description="Same email apart from dots or a +tag, the same phone, or a similar name and email." />
      {access ? (
        <AccessNotice problem={access} title="Contact records are for editors, marketing managers and admins">
          Your role sees aggregate numbers only (PRD 4.3).
        </AccessNotice>
      ) : pairs.isPending ? (
        <SkeletonCard />
      ) : pairs.isError ? (
        <Alert tone="danger" title="Suggestions could not be loaded">
          {pairs.error.message}
        </Alert>
      ) : pairs.data.pairs.length === 0 ? (
        <section className="card">
          <EmptyState title="No possible duplicates" icon={<UsersThree size={28} weight="bold" aria-hidden />}>
            New suggestions appear here after imports and sign-ups.
          </EmptyState>
        </section>
      ) : (
        <div className="stack stack--lg">
          {pairs.data.pairs.map((pair) => (
            <DuplicatePair key={`${pair.contacts[0]!.id}:${pair.contacts[1]!.id}`} reason={pair.reason} a={pair.contacts[0]!} b={pair.contacts[1]!} onDone={refresh} />
          ))}
        </div>
      )}
    </>
  );
}
