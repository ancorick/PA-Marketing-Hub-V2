import { ArrowLeft } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { listAnalyticsChannels, peopleBehind, type PersonBehind, type Stage } from '../../lib/api';
import { contactPath, fullName } from '../../lib/contacts';
import { formatPercent } from '../../lib/format';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, Button, DataTable, type Column } from '../../ui';
import { channelLabel, STAGE_LABEL } from './numbers';
import { usePeriod, useModel } from './period';

/** The contacts behind one number (ANL-15): marketing roles only. */
export function PeopleSection({ stage, channel, campaign }: { stage: Stage; channel: string; campaign?: string }) {
  const role = useStaffRole();
  const [period] = usePeriod();
  const [model] = useModel();
  const people = useQuery({ queryKey: ['people-behind', role, period, model, stage, channel, campaign], queryFn: () => peopleBehind(period, model, stage, channel, campaign) });
  const channels = useQuery({ queryKey: ['analytics-channels', role], queryFn: listAnalyticsChannels, staleTime: Infinity });
  const access = accessProblem(people.error);
  if (access)
    return (
      <AccessNotice problem={access} title="Individual contacts are for the marketing team">
        Leadership and viewers see aggregate numbers only (PRD 4.3).
      </AccessNotice>
    );
  const columns: Column<PersonBehind>[] = [
    { key: 'name', header: 'Contact', render: (row) => <a href={contactPath(row.id)}>{fullName(row) ?? row.email ?? 'Contact'}</a>, sortValue: (row) => row.email ?? '' },
    { key: 'email', header: 'Email', render: (row) => row.email ?? '—' },
    { key: 'share', header: 'Share of the credit', numeric: true, render: (row) => formatPercent(row.share, undefined, { maximumFractionDigits: 0 }), sortValue: (row) => row.share },
  ];
  const title = `${STAGE_LABEL[stage]} credited to ${channelLabel(channel, channels.data?.channels)}${campaign ? `, campaign ${campaign}` : ''}`;
  return (
    <section className="card stack" aria-labelledby="people-heading">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} aria-hidden />} onClick={() => history.back()}>
          Back
        </Button>
      </div>
      <h2 id="people-heading">{title}</h2>
      <p className="muted">
        {period.from} to {period.to} · {people.data?.modelLabel ?? ''}
        {people.data && people.data.total > people.data.people.length && ` · showing ${people.data.people.length} of ${people.data.total}`}
      </p>
      {people.isError && <Alert tone="danger" title="Not loaded">{people.error.message}</Alert>}
      <DataTable caption={title} captionHidden columns={columns} rows={people.data?.people ?? []} rowKey={(row) => row.id} loading={people.isPending} empty="Nobody is credited here in this period." />
    </section>
  );
}
