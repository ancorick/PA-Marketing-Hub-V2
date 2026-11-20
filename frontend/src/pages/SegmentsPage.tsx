import { ArrowLeft, Funnel, Plus, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import {
  addSegmentMembers,
  ApiError,
  countSegmentRule,
  createSegment,
  deleteSegment,
  exportSegmentCsv,
  getSegment,
  listSegmentMembers,
  listSegments,
  removeSegmentMembers,
  updateSegment,
  type Segment,
  type SegmentContact,
  type SegmentRule,
} from '../lib/api';
import { contactPath, fullName, LANGUAGE_LABEL, STATUS, TYPE_LABEL } from '../lib/contacts';
import { formatDate, formatNumber } from '../lib/format';
import { useStaffRole } from '../lib/session';
import {
  AccessNotice,
  accessProblem,
  Alert,
  BrandBadge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageHeader,
  retryServerErrors,
  SkeletonCard,
  StatusBadge,
  TextField,
  type Column,
} from '../ui';
import { defaultCondition, SegmentRuleEditor } from './SegmentRuleEditor';

const backLink = (
  <a className="back-link" href="#/audience/segments">
    <ArrowLeft size={16} weight="bold" aria-hidden />
    All segments
  </a>
);

const contactColumns: Column<SegmentContact>[] = [
  { key: 'name', header: 'Contact', render: (c) => <a href={contactPath(c.id)}>{fullName(c) ?? c.email}</a> },
  { key: 'email', header: 'Email', render: (c) => c.email ?? '' },
  { key: 'type', header: 'Type', render: (c) => TYPE_LABEL[c.type] },
  { key: 'language', header: 'Language', render: (c) => LANGUAGE_LABEL[c.language] },
  { key: 'status', header: 'Status', render: (c) => <StatusBadge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</StatusBadge> },
];

/** Audience → Segments: dynamic segments and static lists (AUD-13 to AUD-15). */
export function SegmentsPage() {
  const role = useStaffRole();
  const segments = useQuery({ queryKey: ['segments', role], queryFn: listSegments, retry: retryServerErrors });
  const access = accessProblem(segments.error);
  const columns: Column<Segment>[] = [
    { key: 'name', header: 'Segment', render: (s) => <a href={`#/audience/segments/${s.id}`}>{s.name}</a>, sortValue: (s) => s.name },
    { key: 'type', header: 'Kind', render: (s) => (s.type === 'dynamic' ? 'Dynamic rule' : 'Static list') },
    { key: 'count', header: 'People', numeric: true, render: (s) => <span className="num">{s.lastCount === null ? '—' : formatNumber(s.lastCount)}</span>, sortValue: (s) => s.lastCount ?? 0 },
    { key: 'updated', header: 'Updated', render: (s) => formatDate(s.updatedAt), sortValue: (s) => s.updatedAt },
  ];
  return (
    <>
      <a className="back-link" href="#/audience">
        <ArrowLeft size={16} weight="bold" aria-hidden />
        All contacts
      </a>
      <PageHeader
        title="Audience"
        accent="segments"
        description="Dynamic segments recount at send time; static lists keep hand-picked people."
        actions={
          !access && (
            <a className="btn btn--primary" href="#/audience/segments/new">
              <Plus size={18} weight="bold" aria-hidden />
              New segment
            </a>
          )
        }
      />
      {access ? (
        <AccessNotice problem={access} title="Segments are for editors, marketing managers and admins">
          Your role sees aggregate numbers only (PRD 4.3).
        </AccessNotice>
      ) : (
        <section className="card">
          <DataTable
            caption="Segments"
            captionHidden
            columns={columns}
            rows={segments.data?.segments ?? []}
            rowKey={(s) => s.id}
            loading={segments.isPending}
            error={segments.isError ? segments.error.message : undefined}
            empty={
              <EmptyState title="No segments yet" icon={<Funnel size={28} weight="bold" aria-hidden />}>
                Build the first one, for example “Open day attendees, not applied”.
              </EmptyState>
            }
          />
        </section>
      )}
    </>
  );
}

/** Waits until editing pauses before counting. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Live count and example contacts while the rule is edited (AUD-14, NFR-F2). */
function LiveCount({ rule }: { rule: SegmentRule }) {
  const debounced = useDebounced(rule, 500);
  const count = useQuery({ queryKey: ['segment-count', debounced], queryFn: () => countSegmentRule(debounced), retry: false });
  return (
    <section className="card stack" aria-labelledby="count-heading">
      <div className="card__header">
        <h2 id="count-heading">People matching now</h2>
        <p className="live-count num" role="status" aria-live="polite">
          {count.isPending ? '…' : count.isError ? '—' : formatNumber(count.data.count)}
        </p>
      </div>
      {count.isError && (
        <Alert tone="warning" title="The rule is not complete yet">
          {count.error.message}
        </Alert>
      )}
      {count.data && count.data.sample.length > 0 && <DataTable caption="Examples" columns={contactColumns} rows={count.data.sample} rowKey={(c) => c.id} />}
    </section>
  );
}

function StaticMembers({ segment }: { segment: Segment }) {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [emails, setEmails] = useState('');
  const members = useQuery({ queryKey: ['segment-members', segment.id, offset], queryFn: () => listSegmentMembers(segment.id, offset) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['segment-members', segment.id] });
  const add = useMutation({
    mutationFn: () => addSegmentMembers(segment.id, emails.split(/[\s,;]+/).filter(Boolean)),
    onSuccess: () => {
      setEmails('');
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => removeSegmentMembers(segment.id, [id]), onSuccess: refresh });
  const columns: Column<SegmentContact>[] = [
    ...contactColumns,
    {
      key: 'remove',
      header: 'Action',
      render: (c) => (
        <Button size="sm" variant="ghost" icon={<Trash size={16} weight="bold" aria-hidden />} onClick={() => remove.mutate(c.id)}>
          Remove<span className="visually-hidden"> {c.email}</span>
        </Button>
      ),
    },
  ];
  return (
    <section className="card stack" aria-labelledby="members-heading">
      <h2 id="members-heading">Members {members.data && <span className="badge badge--brand num">{formatNumber(members.data.total)}</span>}</h2>
      <form
        className="add-domain"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <TextField label="Add people by email" hint="Paste emails separated by spaces, commas or new lines. They must already be contacts." value={emails} onChange={(e) => setEmails(e.target.value)} />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={emails.trim() === ''}>
          Add to list
        </Button>
      </form>
      <div role="status" aria-live="polite">
        {add.data && (
          <Alert tone={add.data.notFound.length > 0 ? 'warning' : 'success'} title={`${formatNumber(add.data.added)} added`}>
            {add.data.notFound.length > 0 ? `Not in Audience: ${add.data.notFound.join(', ')}. Add or import them first.` : undefined}
          </Alert>
        )}
      </div>
      <DataTable caption="Members" captionHidden columns={columns} rows={members.data?.contacts ?? []} rowKey={(c) => c.id} loading={members.isPending} empty="No members yet." />
      {members.data && members.data.total > 25 && (
        <div className="cluster spread">
          <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>
            Previous
          </Button>
          <Button size="sm" variant="secondary" disabled={offset + 25 >= members.data.total} onClick={() => setOffset(offset + 25)}>
            Next
          </Button>
        </div>
      )}
    </section>
  );
}

/** Segment builder (PRD 13.6): rule editor, live count, save; static lists show their members. */
export function SegmentPage({ id }: { id: string | null }) {
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const existing = useQuery({ queryKey: ['segment', id, role], queryFn: () => getSegment(id!), enabled: id !== null, retry: retryServerErrors });
  const [name, setName] = useState<string | null>(null);
  const [type, setType] = useState<'dynamic' | 'static'>('dynamic');
  const [rule, setRule] = useState<SegmentRule | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const canExport = role === 'admin' || role === 'marketing_manager';
  const exportCsv = useMutation({ mutationFn: () => exportSegmentCsv(segment!.id, segment!.name), onSuccess: () => setConfirmExport(false) });

  const segment = existing.data;
  const currentRule: SegmentRule = rule ?? segment?.rule ?? { op: 'and', conditions: [defaultCondition('language')] };
  const currentName = name ?? segment?.name ?? '';
  const currentType = segment?.type ?? type;

  const save = useMutation({
    mutationFn: () =>
      segment
        ? updateSegment(segment.id, { name: currentName, ...(segment.type === 'dynamic' && { rule: currentRule }) })
        : createSegment({ name: currentName, type, ...(type === 'dynamic' && { rule: currentRule }) }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['segments'] });
      queryClient.setQueryData(['segment', saved.id, role], saved);
      setName(null);
      setRule(null);
      if (!segment) window.location.hash = `#/audience/segments/${saved.id}`;
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteSegment(segment!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['segments'] });
      window.location.hash = '#/audience/segments';
    },
  });

  const access = accessProblem(existing.error);
  if (access) {
    return (
      <>
        {backLink}
        <AccessNotice problem={access} title="Segments are for editors, marketing managers and admins">
          Your role sees aggregate numbers only (PRD 4.3).
        </AccessNotice>
      </>
    );
  }
  if (id !== null && existing.isPending) return <SkeletonCard />;
  if (id !== null && !segment) return <>{backLink}<Alert tone="danger" title="Segment not found" /></>;

  const error = save.error instanceof ApiError ? save.error : null;
  return (
    <>
      {backLink}
      <PageHeader
        title={segment ? segment.name : 'New'}
        accent={segment ? undefined : 'segment'}
        description={currentType === 'dynamic' ? 'A rule: membership is recalculated at send time.' : 'A static list of hand-picked people.'}
        actions={segment && (
          <>
            {canExport && (
              <Button variant="secondary" onClick={() => setConfirmExport(true)}>
                Export CSV
              </Button>
            )}
            <Button variant="ghost" icon={<Trash size={18} weight="bold" aria-hidden />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </>
        )}
      />
      <div className="stack stack--lg">
        <section className="card stack" aria-labelledby="segment-heading">
          <div className="cluster">
            <BrandBadge>Segment</BrandBadge>
            <h2 id="segment-heading">Definition</h2>
          </div>
          <div className="form-row">
            <TextField label="Name" required value={currentName} error={error?.message} onChange={(e) => setName(e.target.value)} />
          </div>
          {!segment && (
            <div className="segmented" role="group" aria-label="Kind of segment">
              <button type="button" className="segmented__btn" aria-pressed={type === 'dynamic'} onClick={() => setType('dynamic')}>
                Dynamic rule
              </button>
              <button type="button" className="segmented__btn" aria-pressed={type === 'static'} onClick={() => setType('static')}>
                Static list
              </button>
            </div>
          )}
          {currentType === 'dynamic' && <SegmentRuleEditor rule={currentRule} onChange={setRule} />}
          <div className="cluster">
            <Button variant="primary" loading={save.isPending} disabled={currentName.trim() === ''} onClick={() => save.mutate()}>
              {segment ? 'Save segment' : currentType === 'static' ? 'Create list' : 'Save segment'}
            </Button>
            {save.isSuccess && <span role="status" className="muted">Saved.</span>}
          </div>
        </section>
        {currentType === 'dynamic' && <LiveCount rule={currentRule} />}
        {segment?.type === 'static' && <StaticMembers segment={segment} />}
      </div>
      <ConfirmDialog
        open={confirmExport}
        title={`Export ${segment?.name ?? 'segment'} as CSV?`}
        confirmLabel="Export"
        tone="primary"
        affected={{ count: segment?.lastCount ?? 0, noun: 'people' }}
        busy={exportCsv.isPending}
        onConfirm={() => exportCsv.mutate()}
        onCancel={() => setConfirmExport(false)}
      >
        <p>The file holds personal data. The export is logged with your name, the time, the segment and the row count (AUD-19). Keep the file only as long as you need it.</p>
        {exportCsv.isError && <Alert tone="danger" title="Export failed">{exportCsv.error.message}</Alert>}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${segment?.name ?? 'segment'}?`}
        confirmLabel="Delete segment"
        affected={{ count: segment?.lastCount ?? 0, noun: 'people in it (their contact records stay)' }}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>The segment is removed. Contacts are not deleted; campaigns that used it must choose another segment.</p>
      </ConfirmDialog>
    </>
  );
}
