import { ArrowLeft, PencilSimple, UserCircle } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, getContact, listChannels, type Contact } from '../lib/api';
import { contactPath, fullName, LANGUAGE_LABEL, STATUS, TYPE_LABEL } from '../lib/contacts';
import { formatDate } from '../lib/format';
import { useStaffRole } from '../lib/session';
import {
  AccessNotice,
  accessProblem,
  Alert,
  Button,
  EmptyState,
  PageHeader,
  retryServerErrors,
  SkeletonCard,
  StatusBadge,
  Tag,
} from '../ui';
import { ContactForm } from './ContactForm';

const FIELD_LABEL: Record<string, string> = {
  email: 'email',
  firstName: 'first name',
  lastName: 'last name',
  phone: 'phone',
  language: 'language',
  type: 'type',
  sourceChannel: 'source channel',
  sourceCampaign: 'source campaign',
  firstTouchAt: 'first touch',
  tags: 'tags',
  corePersonId: 'Core Engine link',
};

const ACTION_LABEL: Record<string, string> = { 'contact.created': 'Created', 'contact.updated': 'Changed' };

const formatTime = (iso: string) => formatDate(iso, undefined, { timeStyle: 'short' });

const backLink = (
  <a className="back-link" href="#/audience">
    <ArrowLeft size={16} weight="bold" aria-hidden />
    All contacts
  </a>
);

const ACCESS_TITLE = 'Contact records are for editors, marketing managers and admins';
const ACCESS_TEXT = 'Your role sees aggregate numbers only (PRD 4.3). Ask an admin if you need access to individual records.';

/** Audience → Add contact (AUD-02). */
export function NewContactPage() {
  const queryClient = useQueryClient();
  const saved = (contact: Contact) => {
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    window.location.hash = contactPath(contact.id);
  };
  return (
    <>
      {backLink}
      <PageHeader title="Add" accent="contact" description="Marketing Hub keeps one record per person, matched by email and Core Engine person." />
      <section className="card">
        <ContactForm onSaved={saved} onCancel={() => (window.location.hash = '#/audience')} />
      </section>
    </>
  );
}

/** Audience → one contact: its record, editing and change history (AUD-01, AUD-02, PRD 12.4). */
export function ContactPage({ id }: { id: string }) {
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const contact = useQuery({ queryKey: ['contact', id, role], queryFn: () => getContact(id), retry: retryServerErrors });
  const channels = useQuery({ queryKey: ['audience-channels'], queryFn: listChannels, staleTime: Infinity, enabled: contact.isSuccess });

  const access = accessProblem(contact.error);
  const data = contact.data;

  if (access) {
    return (
      <>
        {backLink}
        <PageHeader title="Contact" />
        <AccessNotice problem={access} title={ACCESS_TITLE}>
          {ACCESS_TEXT}
        </AccessNotice>
      </>
    );
  }
  if (contact.isPending) return <SkeletonCard />;
  if (contact.isError || !data) {
    const missing = contact.error instanceof ApiError && contact.error.status === 404;
    return (
      <>
        {backLink}
        <PageHeader title="Contact" />
        {missing ? (
          <section className="card">
            <EmptyState title="This contact does not exist" icon={<UserCircle size={28} weight="bold" aria-hidden />}>
              It may have been merged into another record. Search for the person in the contact list.
            </EmptyState>
          </section>
        ) : (
          <Alert
            tone="danger"
            title="The contact could not be loaded"
            action={
              <Button size="sm" variant="secondary" onClick={() => void contact.refetch()}>
                Try again
              </Button>
            }
          >
            {contact.error?.message}. Check that the backend is running.
          </Alert>
        )}
      </>
    );
  }

  const name = fullName(data);
  const channel = channels.data?.channels.find((item) => item.id === data.sourceChannel)?.name ?? data.sourceChannel;
  const saved = () => {
    setEditing(false);
    void queryClient.invalidateQueries({ queryKey: ['contact', id] });
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };

  return (
    <>
      {backLink}
      <PageHeader
        title={name ?? data.email ?? 'Erased contact'}
        description={name ? data.email : undefined}
        actions={
          !editing &&
          data.status !== 'erased' && (
            <Button variant="secondary" icon={<PencilSimple size={18} weight="bold" aria-hidden />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      />
      <div className="stack stack--lg">
        {editing ? (
          <section className="card stack" aria-labelledby="edit-heading">
            <h2 id="edit-heading">Edit contact</h2>
            <ContactForm contact={data} onSaved={saved} onCancel={() => setEditing(false)} />
          </section>
        ) : (
          <section className="card stack" aria-labelledby="record-heading">
            <div className="card__header">
              <h2 id="record-heading">Record</h2>
              <StatusBadge tone={STATUS[data.status].tone}>{STATUS[data.status].label}</StatusBadge>
            </div>
            <dl className="facts">
              <div>
                <dt>Type</dt>
                <dd>
                  {TYPE_LABEL[data.type]}
                  {data.typeSource === 'core_engine' && <span className="muted">from the Core Engine</span>}
                </dd>
              </div>
              <div>
                <dt>Preferred language</dt>
                <dd>{LANGUAGE_LABEL[data.language]}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{data.phone ? <span className="num">{data.phone}</span> : <span className="muted">Not given</span>}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  {channel ?? <span className="muted">Unknown</span>}
                  {data.sourceCampaign && <code>{data.sourceCampaign}</code>}
                </dd>
              </div>
              <div>
                <dt>First touch</dt>
                <dd className="num">{formatDate(data.firstTouchAt)}</dd>
              </div>
              <div>
                <dt>Core Engine person</dt>
                <dd>{data.corePersonId ? <code>{data.corePersonId}</code> : <span className="muted">Not linked</span>}</dd>
              </div>
              <div className="facts__wide">
                <dt>Tags</dt>
                <dd>{data.tags.length > 0 ? data.tags.map((tag) => <Tag key={tag}>#{tag}</Tag>) : <span className="muted">None</span>}</dd>
              </div>
            </dl>
          </section>
        )}

        <section className="card stack" aria-labelledby="history-heading">
          <h2 id="history-heading">Change history</h2>
          <p className="muted">Who changed which fields. Values are not kept here, so erasing a contact leaves no personal data behind.</p>
          <ol className="list-reset history">
            {[...data.history].reverse().map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="history__item">
                <span className="history__time num">{formatTime(entry.at)}</span>
                <span>
                  <strong>{ACTION_LABEL[entry.action] ?? entry.action}</strong> by {entry.actorId}
                  {entry.action !== 'contact.created' && entry.fields.length > 0 && (
                    <>: {entry.fields.map((field) => FIELD_LABEL[field] ?? field).join(', ')}</>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
