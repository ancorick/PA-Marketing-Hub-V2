import { ArrowClockwise, ArrowLeft } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { collectIssue, getIssue, type CollectedItem, type IssueDetail } from '../lib/api';
import { LANGUAGE_LABEL } from '../lib/contacts';
import { formatDate } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { Disclosure } from '../motion';
import { AccessNotice, accessProblem, Alert, Button, PageHeader, retryServerErrors, SkeletonCard, StatusBadge } from '../ui';
import { IssueEditor } from './IssueEditor';
import { IssueReport } from './IssueReport';
import { IssueReview } from './IssueReview';
import { ISSUE_STATUS } from './NewsletterPage';

const SOURCE_LABEL: Record<CollectedItem['type'], string> = {
  upcoming_event: 'Upcoming event',
  recent_event: 'Recent event',
  library: 'Library',
  graduation: 'Graduation',
  hire: 'Alumni hire',
  new_group: 'New group',
};

const formatTime = (iso: string) => formatDate(iso, undefined, { timeStyle: 'short' });

/** 8.5: items a publish rule left out, with the reason, so the editor knows why they are missing. */
export function SkippedItems({ items }: { items: CollectedItem[] }) {
  const skipped = items.filter((item) => !item.publishable);
  return (
    <Disclosure title={`Skipped items (${skipped.length})`}>
      {skipped.length === 0 ? (
        <p className="muted">Every collected item passed its publish rule.</p>
      ) : (
        <ul className="list-reset history">
          {skipped.map((item) => (
            <li key={item.id} className="history__item">
              <span className="history__time">{SOURCE_LABEL[item.type]}</span>
              <span>
                <strong>{item.title}</strong> <span className="muted">· {item.skipReason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  );
}

export function IssueHeader({ data, back }: { data: IssueDetail; back: React.ReactNode }) {
  const { issue } = data;
  return (
    <>
      {back}
      <PageHeader
        title={issue.subject ?? `Edition ${issue.edition}`}
        description={`${LANGUAGE_LABEL[issue.language]} · planned ${formatTime(issue.plannedSendAt)} · items since ${formatDate(issue.periodStart)}`}
      />
      <div className="cluster">
        <StatusBadge tone={ISSUE_STATUS[issue.status].tone}>{ISSUE_STATUS[issue.status].label}</StatusBadge>
      </div>
    </>
  );
}

/** One issue: blocks of the draft, skipped items, collect or redraft (NWS-02, NWS-03). */
export function IssuePage({ id }: { id: string }) {
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['issue', id, role], queryFn: () => getIssue(id), retry: retryServerErrors });
  const collect = useMutation({ mutationFn: () => collectIssue(id), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['issue', id] }) });
  const back = (
    <a className="back-link" href="#/newsletter">
      <ArrowLeft size={16} weight="bold" aria-hidden />
      All issues
    </a>
  );
  const access = accessProblem(detail.error);
  if (access) return <>{back}<AccessNotice problem={access} title="The newsletter is for editors, marketing managers and admins">Ask an admin if you need access.</AccessNotice></>;
  if (detail.isPending) return <SkeletonCard />;
  if (detail.isError) return <>{back}<Alert tone="danger" title="Issue not found">{detail.error.message}</Alert></>;
  const { issue, items } = detail.data;
  const canCollect = issue.status === 'collecting' || issue.status === 'draft';

  return (
    <>
      <IssueHeader data={detail.data} back={back} />
      <div className="stack stack--lg page-section">
        {canCollect && (
          <section className="card stack" aria-labelledby="collect-heading">
            <h2 id="collect-heading">{issue.status === 'collecting' ? 'Not drafted yet' : 'Draft'}</h2>
            <p className="muted">
              {issue.status === 'collecting'
                ? `Collectors run on ${formatTime(issue.collectAt)}. Collect now to see the draft early.`
                : 'Redraft to pick up new items from the sources. Edits to blocks are replaced.'}
            </p>
            <div>
              <Button variant="secondary" icon={<ArrowClockwise size={18} weight="bold" aria-hidden />} loading={collect.isPending} onClick={() => collect.mutate()}>
                {issue.status === 'collecting' ? 'Collect and draft now' : 'Redraft from sources'}
              </Button>
            </div>
            {collect.isError && <Alert tone="danger" title="Collect failed">{collect.error.message}</Alert>}
          </section>
        )}
        {issue.status !== 'collecting' && <IssueEditor data={detail.data} />}
        {issue.status === 'sent' && <IssueReport issueId={issue.id} archiveSlug={issue.archiveSlug} />}
        {issue.status !== 'collecting' && <IssueReview issue={issue} />}
        <section className="card stack" aria-labelledby="items-heading">
          <h2 id="items-heading">Collected items</h2>
          <p className="muted">{items.filter((item) => item.used).length} in the draft, {items.filter((item) => item.publishable && !item.used).length} more available.</p>
          <SkippedItems items={items} />
        </section>
      </div>
    </>
  );
}
