import { ArrowSquareOut, CaretLeft, CaretRight, MagnifyingGlass, Plus, UsersThree, X } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  getAudienceSummary,
  getConsent,
  getContact,
  getSuppressionSummary,
  listChannels,
  listContacts,
  type ConsentState,
  type ContactFilters,
  type ContactRow,
  type ContactStatus,
  type ContactType,
  type Language,
} from '../../lib/api';
import { contactPath, fullName } from '../../lib/contacts';
import { formatNumber } from '../../lib/format';
import { useT, type StringKey } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import {
  AccessNotice,
  accessProblem,
  Alert,
  Button,
  Chip,
  DataTable,
  Drawer,
  EmptyState,
  FilterBar,
  PageHeader,
  retryServerErrors,
  Skeleton,
  StatTile,
  StatusBadge,
  Tag,
  type Column,
  type Tone,
} from '../../ui';
import { countText } from '../analytics/numbers';
import { useDayLabel } from '../measure/shared';

const PAGE_SIZE = 50;
const TYPES: ContactType[] = ['subscriber', 'lead', 'applicant', 'student', 'alumnus'];
const STATUSES: ContactStatus[] = ['active', 'unsubscribed', 'bounced', 'complained', 'erased'];
const LANGUAGES: Language[] = ['hy', 'en', 'ru'];

export const TYPE_KEY: Record<ContactType, StringKey> = { subscriber: 'r.type.subscriber', lead: 'r.type.lead', applicant: 'r.type.applicant', student: 'r.type.student', alumnus: 'r.type.alumnus' };
export const LANGUAGE_KEY: Record<Language, StringKey> = { hy: 'r.lang.hy', en: 'r.lang.en', ru: 'r.lang.ru' };
const STATUS: Record<ContactStatus, { tone: Tone; key: StringKey }> = {
  active: { tone: 'success', key: 'r.status.active' },
  unsubscribed: { tone: 'neutral', key: 'r.status.unsubscribed' },
  bounced: { tone: 'danger', key: 'r.status.bounced' },
  complained: { tone: 'danger', key: 'r.status.complained' },
  erased: { tone: 'neutral', key: 'r.status.erased' },
};
export const CONSENT: Record<ConsentState, { tone: Tone; key: StringKey }> = {
  granted: { tone: 'success', key: 'r.consent.granted' },
  withdrawn: { tone: 'danger', key: 'r.consent.withdrawn' },
  pending: { tone: 'warning', key: 'r.consent.pending' },
  unknown: { tone: 'neutral', key: 'r.consent.unknown' },
};

/*
 * Lookups never throw on a value the API did not send or added later (for example a backend without the
 * newsletterConsent field yet): an unknown consent reads as "unknown", an unknown status, type or language as is.
 */
const consentOf = (state: ConsentState | undefined) => CONSENT[state ?? 'unknown'] ?? CONSENT.unknown;
const statusOf = (status: ContactStatus) => STATUS[status] ?? { tone: 'neutral' as Tone, key: null };
export function useContactLabels() {
  const t = useT();
  return {
    type: (type: ContactType) => (TYPE_KEY[type] ? t(TYPE_KEY[type]) : type),
    language: (language: Language) => (LANGUAGE_KEY[language] ? t(LANGUAGE_KEY[language]) : language),
    status: (status: ContactStatus) => {
      const key = statusOf(status).key;
      return key ? t(key) : status;
    },
  };
}

type Filters = { q: string; type: ContactType | ''; status: ContactStatus | ''; language: Language | ''; tag: string; offset: number };
const EMPTY: Filters = { q: '', type: '', status: '', language: '', tag: '', offset: 0 };
/** Kept for the tab's lifetime, so coming back from a contact restores the search and page. */
let savedFilters: Filters = EMPTY;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Contacts (PRD 13.6, AUD-01, AUD-02; RESTRUCTURE R4): search by name, email or phone, filters by type, status
 * and language, the metric strip, the list with badges and the contact card in a side panel.
 */
export function ContactsPage() {
  const t = useT();
  const label = useContactLabels();
  const role = useStaffRole();
  const dayLabel = useDayLabel();
  const [filters, setFilters] = useState<Filters>(savedFilters);
  const [open, setOpen] = useState<ContactRow | null>(null);
  const q = useDebounced(filters.q, 300);
  useEffect(() => {
    savedFilters = filters;
  }, [filters]);
  const update = (change: Partial<Filters>) => setFilters((current) => ({ ...current, offset: 0, ...change }));

  const query: ContactFilters = {
    q: q.trim() || undefined,
    type: filters.type || undefined,
    status: filters.status || undefined,
    language: filters.language || undefined,
    tag: filters.tag || undefined,
    limit: PAGE_SIZE,
    offset: filters.offset,
  };
  const contacts = useQuery({ queryKey: ['contacts', role, query], queryFn: () => listContacts(query), placeholderData: keepPreviousData, retry: retryServerErrors });
  const channels = useQuery({ queryKey: ['audience-channels'], queryFn: listChannels, staleTime: Infinity, enabled: !contacts.error });
  const summary = useQuery({ queryKey: ['audience-summary', role], queryFn: getAudienceSummary });
  const suppression = useQuery({ queryKey: ['suppression-summary', role], queryFn: getSuppressionSummary, enabled: !contacts.error });
  const channelName = (id: string | null) => (id === null ? '—' : (channels.data?.channels.find((channel) => channel.id === id)?.name ?? id));

  const access = accessProblem(contacts.error);
  const data = contacts.data;
  const filtered = Boolean(query.q || query.type || query.status || query.language || query.tag);
  const from = data && data.total > 0 ? data.offset + 1 : 0;
  const to = data ? Math.min(data.offset + data.contacts.length, data.total) : 0;
  const tile = (value: number | 'fewer_than_3' | undefined) => (value === undefined ? '—' : value === 'fewer_than_3' ? null : formatNumber(value));
  const suppressionCaption = suppression.data
    ? [
        [t('r.suppr.unsubscribed'), suppression.data.active.unsubscribed],
        [t('r.suppr.hard_bounce'), suppression.data.active.hard_bounce],
        [t('r.suppr.complaint'), suppression.data.active.complaint],
      ]
        .map(([label, value]) => `${label} ${formatNumber(Number(value))}`)
        .join(' · ')
    : undefined;

  const columns: Column<ContactRow>[] = [
    {
      key: 'name',
      header: t('r.name'),
      render: (row) => (
        <button type="button" className="link-button nowrap" onClick={() => setOpen(row)}>
          {fullName(row) ?? row.email ?? t('r.erasedContact')}
        </button>
      ),
    },
    { key: 'email', header: t('r.email'), render: (row) => <span className="break-anywhere">{row.email ?? '—'}</span>, csv: (row) => row.email },
    { key: 'type', header: t('r.type'), render: (row) => <Tag>{label.type(row.type)}</Tag>, csv: (row) => row.type },
    { key: 'language', header: t('r.language'), render: (row) => <span className="num">{row.language.toUpperCase()}</span>, csv: (row) => row.language },
    { key: 'consent', header: t('r.newsletterConsent'), render: (row) => <StatusBadge tone={consentOf(row.newsletterConsent).tone}>{t(consentOf(row.newsletterConsent).key)}</StatusBadge>, csv: (row) => row.newsletterConsent ?? 'unknown' },
    { key: 'status', header: t('r.status'), render: (row) => <StatusBadge tone={statusOf(row.status).tone}>{label.status(row.status)}</StatusBadge>, csv: (row) => row.status },
    { key: 'firstTouch', header: t('r.firstTouch'), render: (row) => <span className="num nowrap">{dayLabel(row.firstTouchAt, true)}</span>, csv: (row) => row.firstTouchAt.slice(0, 10) },
    { key: 'source', header: t('r.source'), render: (row) => <span className="nowrap">{channelName(row.sourceChannel)}</span>, csv: (row) => channelName(row.sourceChannel) },
  ];

  const selectFilter = <V extends string>(label: string, value: V | '', all: string, values: V[], name: (value: V) => string, onChange: (value: V | '') => void) => (
    <label className="filter">
      <span className="visually-hidden">{label}</span>
      <select className="select select--sm" value={value} onChange={(event) => onChange(event.target.value as V | '')}>
        <option value="">{all}</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {name(item)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <PageHeader
        title={t('nav.contacts')}
        description={t('r.contactsDescription')}
        actions={
          !access && (
            <>
              <a className="btn btn--secondary" href="#/contacts/duplicates">
                {t('r.reviewDuplicates')}
              </a>
              <a className="btn btn--secondary" href="#/contacts/import">
                {t('r.importCsv')}
              </a>
              <a className="btn btn--primary" href="#/contacts/new">
                <Plus size={18} weight="bold" aria-hidden />
                {t('r.addContact')}
              </a>
            </>
          )
        }
      />
      {access ? (
        <AccessNotice problem={access} title={t('r.contactsAccess')}>
          {t('r.contactsAccessHint')}
        </AccessNotice>
      ) : (
        <>
          <FilterBar label={t('m.filters')}>
            <label className="filter filter--search">
              <MagnifyingGlass size={18} aria-hidden />
              <span className="visually-hidden">{t('r.search')}</span>
              <input className="input input--sm" type="search" placeholder={t('r.search')} value={filters.q} onChange={(event) => update({ q: event.target.value })} />
            </label>
            {selectFilter(t('r.type'), filters.type, t('r.allTypes'), TYPES, (value) => t(TYPE_KEY[value]), (type) => update({ type }))}
            {selectFilter(t('r.status'), filters.status, t('r.anyStatus'), STATUSES, (value) => t(STATUS[value].key), (status) => update({ status }))}
            {selectFilter(t('r.language'), filters.language, t('r.allLanguages'), LANGUAGES, (value) => t(LANGUAGE_KEY[value]), (language) => update({ language }))}
            {filters.tag && (
              <Chip selected icon={<X size={14} weight="bold" aria-hidden />} onClick={() => update({ tag: '' })} aria-label={t('r.removeTag', { tag: filters.tag })}>
                #{filters.tag}
              </Chip>
            )}
            {filtered && (
              <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY)}>
                {t('r.clearFilters')}
              </Button>
            )}
          </FilterBar>
          <div className="stack stack--lg">
            <div className="grid-12">
              <div className="span-3">
                <StatTile tone="yellow" label={t('r.tileContacts')} value={tile(summary.data?.total)} caption={t('r.tileContactsCaption')} definition={t('r.tileContactsDefinition')} />
              </div>
              <div className="span-3">
                <StatTile
                  label={t('r.tileConsent')}
                  value={tile(summary.data?.withConsent)}
                  caption={
                    typeof summary.data?.withConsent === 'number' && typeof summary.data.total === 'number' && summary.data.total > 0
                      ? t('r.ofAll', { pct: `${Math.round((summary.data.withConsent / summary.data.total) * 1000) / 10}%` })
                      : undefined
                  }
                  definition={t('r.tileConsentDefinition')}
                />
              </div>
              <div className="span-3">
                <StatTile label={t('r.tileUnsubscribed')} value={tile(summary.data?.unsubscribed)} caption={t('r.tileUnsubscribedCaption')} definition={t('r.tileUnsubscribedDefinition')} />
              </div>
              <div className="span-3">
                <StatTile label={t('r.tileSuppressed')} value={tile(summary.data?.suppressed)} caption={suppressionCaption} definition={t('r.tileSuppressedDefinition')} />
              </div>
            </div>

            {contacts.isError && (
              <Alert
                tone="danger"
                title={t('m.notLoaded')}
                action={
                  <Button size="sm" variant="secondary" onClick={() => void contacts.refetch()}>
                    {t('r.tryAgain')}
                  </Button>
                }
              >
                {contacts.error.message}
              </Alert>
            )}

            <section className="card stack" aria-labelledby="contacts-heading">
              <div className="card__header">
                <h2 id="contacts-heading" className="num">
                  {data ? t('r.contactsCount', { n: formatNumber(data.total) }) : t('nav.contacts')}
                </h2>
                <p role="status" aria-live="polite" className="muted num">
                  {data && data.total > 0 ? t('table.range', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(data.total) }) : ''}
                </p>
              </div>
              <DataTable
                caption={t('nav.contacts')}
                captionHidden
                columns={columns}
                rows={data?.contacts ?? []}
                rowKey={(row) => row.id}
                loading={contacts.isPending}
                dense
                empty={
                  <EmptyState
                    title={filtered ? t('r.noMatch') : t('r.noContacts')}
                    icon={<UsersThree size={28} weight="bold" aria-hidden />}
                    action={
                      filtered ? (
                        <Button size="sm" variant="secondary" onClick={() => setFilters(EMPTY)}>
                          {t('r.clearFilters')}
                        </Button>
                      ) : undefined
                    }
                  >
                    {filtered ? t('r.noMatchHint') : t('r.noContactsHint')}
                  </EmptyState>
                }
              />
              {data && data.total > PAGE_SIZE && (
                <nav className="pager" aria-label={t('r.pages')}>
                  <span className="muted num">{t('table.range', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(data.total) })}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    aria-label={t('table.previous')}
                    icon={<CaretLeft size={16} weight="bold" aria-hidden />}
                    disabled={filters.offset === 0}
                    onClick={() => setFilters((current) => ({ ...current, offset: Math.max(0, current.offset - PAGE_SIZE) }))}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    aria-label={t('table.next')}
                    icon={<CaretRight size={16} weight="bold" aria-hidden />}
                    disabled={to >= data.total}
                    onClick={() => setFilters((current) => ({ ...current, offset: current.offset + PAGE_SIZE }))}
                  />
                </nav>
              )}
            </section>
          </div>
        </>
      )}
      <ContactDrawer contact={open} channelName={channelName} onClose={() => setOpen(null)} onTag={(tag) => update({ tag })} />
    </>
  );
}

/** Contact card in the side panel: who it is, where they came from, consent per topic; the full record is one click away. */
function ContactDrawer({ contact, channelName, onClose, onTag }: { contact: ContactRow | null; channelName: (id: string | null) => string; onClose: () => void; onTag: (tag: string) => void }) {
  const t = useT();
  const label = useContactLabels();
  const role = useStaffRole();
  const dayLabel = useDayLabel();
  const id = contact?.id ?? '';
  const detail = useQuery({ queryKey: ['contact', role, id], queryFn: () => getContact(id), enabled: Boolean(contact) });
  const consent = useQuery({ queryKey: ['consent', role, id], queryFn: () => getConsent(id), enabled: Boolean(contact) });
  const record = detail.data ?? contact;
  return (
    <Drawer
      open={contact !== null}
      onClose={onClose}
      title={record ? (fullName(record) ?? record.email ?? t('r.erasedContact')) : ''}
      description={record?.email ?? undefined}
      footer={
        contact && (
          <a className="btn btn--primary" href={contactPath(contact.id)} onClick={onClose}>
            <ArrowSquareOut size={18} aria-hidden />
            {t('r.openRecord')}
          </a>
        )
      }
    >
      {record && (
        <div className="stack stack--lg">
          <div className="cluster">
            <Tag>{label.type(record.type)}</Tag>
            <StatusBadge tone={statusOf(record.status).tone}>{label.status(record.status)}</StatusBadge>
          </div>
          <dl className="facts facts--compact">
            <div>
              <dt>{t('r.phone')}</dt>
              <dd className="num">{record.phone ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('r.language')}</dt>
              <dd>{label.language(record.language)}</dd>
            </div>
            <div>
              <dt>{t('r.source')}</dt>
              <dd>
                {channelName(record.sourceChannel)}
                {record.sourceCampaign && (
                  <>
                    {' · '}
                    <code>{record.sourceCampaign}</code>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>{t('r.firstTouch')}</dt>
              <dd className="num">{dayLabel(record.firstTouchAt, true)}</dd>
            </div>
            <div>
              <dt>{t('r.added')}</dt>
              <dd className="num">{dayLabel(record.createdAt, true)}</dd>
            </div>
            <div>
              <dt>{t('r.lifecycle')}</dt>
              <dd>{record.typeSource === 'core_engine' ? t('r.fromCoreEngine') : t('r.fromMarketingHub')}</dd>
            </div>
          </dl>
          {record.tags.length > 0 && (
            <div className="cluster" aria-label={t('r.tags')}>
              {record.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="tag tag--button"
                  onClick={() => {
                    onTag(tag);
                    onClose();
                  }}
                  aria-label={t('r.showTagged', { tag })}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
          <section className="stack stack--sm" aria-labelledby="drawer-consent">
            <h3 id="drawer-consent">{t('r.consentTitle')}</h3>
            {consent.isPending ? (
              <Skeleton height="6rem" />
            ) : consent.isError ? (
              <Alert tone="danger" title={t('m.notLoaded')}>
                {consent.error.message}
              </Alert>
            ) : (
              <ul className="list-reset stack stack--sm">
                {consent.data.topics.map((topic) => (
                  <li key={topic.topic} className="cluster spread">
                    <span>{t(`r.topic.${topic.topic}` as StringKey)}</span>
                    <span className="cluster cluster--nowrap">
                      <StatusBadge tone={consentOf(topic.state).tone}>{t(consentOf(topic.state).key)}</StatusBadge>
                      {topic.since && <span className="muted num text-xs">{dayLabel(topic.since, true)}</span>}
                    </span>
                  </li>
                ))}
                {consent.data.suppressed.map((item) => (
                  <li key={item.reason}>
                    <StatusBadge tone="danger">
                      {t('r.suppressedAs', { reason: t(`r.suppr.${item.reason}` as StringKey) })} · {dayLabel(item.since, true)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="note">{t('r.drawerHint', { n: countText(detail.data?.history.length ?? 0) })}</p>
        </div>
      )}
    </Drawer>
  );
}
