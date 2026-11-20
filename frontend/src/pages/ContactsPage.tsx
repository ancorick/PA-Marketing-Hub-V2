import { Plus, UsersThree, X } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getSuppressionSummary, listChannels, listContacts, type Contact, type ContactFilters, type ContactType, type Language } from '../lib/api';
import { contactPath, fullName, LANGUAGE_LABEL, options, STATUS, SUPPRESSION_LABEL, TYPE_LABEL } from '../lib/contacts';
import { formatDate, formatNumber } from '../lib/format';
import { useStaffRole } from '../lib/session';
import {
  AccessNotice,
  accessProblem,
  Alert,
  Button,
  Chip,
  DataTable,
  EmptyState,
  PageHeader,
  retryServerErrors,
  SearchField,
  SelectField,
  StatusBadge,
  type Column,
} from '../ui';

const PAGE_SIZE = 25;

type Filters = { q: string; type: ContactType | ''; language: Language | ''; tag: string; offset: number };

/** Kept for the tab's lifetime, so coming back from a contact restores the search and page. */
let savedFilters: Filters = { q: '', type: '', language: '', tag: '', offset: 0 };

/** Waits until typing pauses before searching. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function columns(channelName: (id: string | null) => string, onTag: (tag: string) => void): Column<Contact>[] {
  return [
    {
      key: 'name',
      header: 'Contact',
      render: (contact) => (
        <div className="stack stack--xs contact-cell">
          <a href={contactPath(contact.id)}>{fullName(contact) ?? contact.email ?? 'Erased contact'}</a>
          {fullName(contact) && contact.email && <span className="muted">{contact.email}</span>}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (contact) => (
        <div className="stack stack--xs">
          <span>{TYPE_LABEL[contact.type]}</span>
          {contact.typeSource === 'core_engine' && <span className="muted">From Core Engine</span>}
        </div>
      ),
    },
    { key: 'language', header: 'Language', render: (contact) => LANGUAGE_LABEL[contact.language] },
    {
      key: 'source',
      header: 'Source',
      render: (contact) => (
        <div className="stack stack--xs">
          <span>{channelName(contact.sourceChannel)}</span>
          {contact.sourceCampaign && <code className="muted">{contact.sourceCampaign}</code>}
        </div>
      ),
    },
    { key: 'firstTouch', header: 'First touch', render: (contact) => <span className="num">{formatDate(contact.firstTouchAt)}</span> },
    {
      key: 'tags',
      header: 'Tags',
      render: (contact) =>
        contact.tags.length === 0 ? (
          <span className="muted">None</span>
        ) : (
          <div className="cluster contact-tags">
            {contact.tags.map((tag) => (
              <button key={tag} type="button" className="tag tag--button" onClick={() => onTag(tag)} aria-label={`Show contacts tagged ${tag}`}>
                #{tag}
              </button>
            ))}
          </div>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (contact) => <StatusBadge tone={STATUS[contact.status].tone}>{STATUS[contact.status].label}</StatusBadge>,
    },
  ];
}

/**
 * Audience → Contacts (PRD 13.6): search, filters and the one-record-per-person list (AUD-01, AUD-02).
 * Merge suggestions (AUD-04) and the timeline (AUD-16) join this screen later.
 */
export function ContactsPage() {
  const role = useStaffRole();
  const [filters, setFilters] = useState<Filters>(savedFilters);
  const q = useDebounced(filters.q, 300);
  useEffect(() => {
    savedFilters = filters;
  }, [filters]);

  const update = (change: Partial<Filters>) => setFilters((current) => ({ ...current, offset: 0, ...change }));

  const query: ContactFilters = {
    q: q.trim() || undefined,
    type: filters.type || undefined,
    language: filters.language || undefined,
    tag: filters.tag || undefined,
    limit: PAGE_SIZE,
    offset: filters.offset,
  };
  const contacts = useQuery({
    // The role is part of the key: switching the mock role refetches with the new token.
    queryKey: ['contacts', role, query],
    queryFn: () => listContacts(query),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
  });
  const channels = useQuery({ queryKey: ['audience-channels'], queryFn: listChannels, staleTime: Infinity, enabled: !contacts.error });
  const channelName = (id: string | null) =>
    id === null ? 'Unknown' : (channels.data?.channels.find((channel) => channel.id === id)?.name ?? id);

  const suppression = useQuery({ queryKey: ['suppression-summary', role], queryFn: getSuppressionSummary, enabled: !contacts.error });
  const access = accessProblem(contacts.error);
  const data = contacts.data;
  const filtered = Boolean(query.q || query.type || query.language || query.tag);
  const from = data && data.total > 0 ? data.offset + 1 : 0;
  const to = data ? Math.min(data.offset + data.contacts.length, data.total) : 0;

  return (
    <>
      <PageHeader
        title="Audience"
        accent="contacts"
        description="One record per person: subscribers, leads, applicants, students and alumni."
        actions={
          !access && (
            <>
              <a className="btn btn--ghost" href="#/audience/duplicates">
                Duplicates
              </a>
              <a className="btn btn--secondary" href="#/audience/import">
                Import CSV
              </a>
              <a className="btn btn--primary" href="#/audience/contacts/new">
                <Plus size={18} weight="bold" aria-hidden />
                Add contact
              </a>
            </>
          )
        }
      />
      {access ? (
        <AccessNotice problem={access} title="Contact records are for editors, marketing managers and admins">
          Your role sees aggregate numbers only (PRD 4.3). Ask an admin if you need access to individual records.
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          <section className="filter-panel" aria-label="Search and filters">
            <SearchField
              label="Search contacts by name or email"
              placeholder="Search by name or email"
              value={filters.q}
              onChange={(event) => update({ q: event.target.value })}
            />
            <div className="contact-filters">
              <div className="stack stack--sm">
                <span className="field__label" id="type-filter-label">
                  Type
                </span>
                <div className="cluster" role="group" aria-labelledby="type-filter-label">
                  <Chip selected={filters.type === ''} onClick={() => update({ type: '' })}>
                    All
                  </Chip>
                  {options(TYPE_LABEL).map(({ value, label }) => (
                    <Chip key={value} selected={filters.type === value} onClick={() => update({ type: value })}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>
              <SelectField
                label="Language"
                options={[{ value: '', label: 'All languages' }, ...options(LANGUAGE_LABEL)]}
                value={filters.language}
                onChange={(event) => update({ language: event.target.value as Language | '' })}
              />
            </div>
            {filters.tag && (
              <div className="cluster">
                <span className="muted">Tagged</span>
                <Chip selected icon={<X size={14} weight="bold" aria-hidden />} onClick={() => update({ tag: '' })} aria-label={`Remove tag filter ${filters.tag}`}>
                  #{filters.tag}
                </Chip>
              </div>
            )}
          </section>

          {contacts.isError && (
            <Alert
              tone="danger"
              title="Contacts could not be loaded"
              action={
                <Button size="sm" variant="secondary" onClick={() => void contacts.refetch()}>
                  Try again
                </Button>
              }
            >
              {contacts.error.message}. Check that the backend is running.
            </Alert>
          )}

          <section className="card stack" aria-labelledby="contacts-heading">
            <div className="card__header">
              <h2 id="contacts-heading">Contacts</h2>
              <p role="status" aria-live="polite" className="num">
                {data
                  ? data.total === 0
                    ? 'No contacts'
                    : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(data.total)}`
                  : 'Loading…'}
              </p>
            </div>
            {suppression.data && (
              <p className="muted">
                Suppression list (AUD-12):{' '}
                {(Object.entries(suppression.data.active) as [keyof typeof SUPPRESSION_LABEL, number][])
                  .map(([reason, count]) => `${SUPPRESSION_LABEL[reason]} ${formatNumber(count)}`)
                  .join(' · ')}
              </p>
            )}
            <DataTable
              caption="Contacts"
              captionHidden
              columns={columns(channelName, (tag) => update({ tag }))}
              rows={data?.contacts ?? []}
              rowKey={(contact) => contact.id}
              loading={contacts.isPending}
              empty={
                <EmptyState
                  title={filtered ? 'No contacts match' : 'No contacts yet'}
                  icon={<UsersThree size={28} weight="bold" aria-hidden />}
                  action={
                    filtered ? (
                      <Button size="sm" variant="secondary" onClick={() => setFilters({ q: '', type: '', language: '', tag: '', offset: 0 })}>
                        Clear search and filters
                      </Button>
                    ) : undefined
                  }
                >
                  {filtered
                    ? 'Try another name or email, or clear the filters.'
                    : 'Add the first contact or import a CSV file.'}
                </EmptyState>
              }
            />
            {data && data.total > PAGE_SIZE && (
              <nav className="cluster spread" aria-label="Contact pages">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={filters.offset === 0}
                  onClick={() => setFilters((current) => ({ ...current, offset: Math.max(0, current.offset - PAGE_SIZE) }))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={to >= data.total}
                  onClick={() => setFilters((current) => ({ ...current, offset: current.offset + PAGE_SIZE }))}
                >
                  Next
                </Button>
              </nav>
            )}
          </section>
        </div>
      )}
    </>
  );
}
