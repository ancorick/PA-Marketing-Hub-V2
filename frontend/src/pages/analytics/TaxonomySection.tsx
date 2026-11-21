import { Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { addChannelRule, ApiError, deleteChannelRule, getTaxonomy, resolveUnmapped, type ChannelRule, type RuleKind, type UnmappedValue } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, Button, DataTable, SelectField, SkeletonCard, StatusBadge, TextField, type Column } from '../../ui';

const KIND_LABEL: Record<RuleKind, string> = {
  source_medium: 'Source and medium',
  medium: 'utm_medium',
  source: 'utm_source',
  crm_label: 'CRM channel label',
};
const SOURCE_LABEL: Record<string, string> = {
  website_analytics: 'Website analytics',
  website_form: 'Website form',
  navigator_crm: 'Navigator CRM',
};

/** One unmapped value with its channel picker (ANL-03). */
function ResolveCell({ value, channels, canEdit, onDone }: { value: UnmappedValue; channels: { id: string; name: string }[]; canEdit: boolean; onDone: () => void }) {
  const [channel, setChannel] = useState('');
  const resolve = useMutation({ mutationFn: () => resolveUnmapped(value.id, channel), onSuccess: onDone });
  if (value.resolvedChannelId)
    return <StatusBadge tone="success">{channels.find((item) => item.id === value.resolvedChannelId)?.name ?? value.resolvedChannelId}</StatusBadge>;
  if (!canEdit) return <StatusBadge tone="warning">Needs a channel</StatusBadge>;
  return (
    <div className="cluster cluster--nowrap">
      <select className="select select--sm" aria-label={`Channel for ${value.value}`} value={channel} onChange={(event) => setChannel(event.target.value)}>
        <option value="">Choose a channel</option>
        {channels.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <Button size="sm" variant="secondary" disabled={!channel} loading={resolve.isPending} onClick={() => resolve.mutate()}>
        Map
      </Button>
      {resolve.isError && <span className="field__error">{resolve.error.message}</span>}
    </div>
  );
}

/** Channel taxonomy settings (PRD 9.3) and the review queue of values nothing maps (ANL-03). */
export function TaxonomySection() {
  const role = useStaffRole();
  const canEdit = role === 'admin' || role === 'marketing_manager';
  const queryClient = useQueryClient();
  const taxonomy = useQuery({ queryKey: ['taxonomy', role], queryFn: getTaxonomy });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['taxonomy'] });
  const [kind, setKind] = useState<RuleKind>('source_medium');
  const [value, setValue] = useState('');
  const [channel, setChannel] = useState('');
  const add = useMutation({
    mutationFn: () => addChannelRule({ kind, value, channel }),
    onSuccess: () => {
      setValue('');
      refresh();
    },
  });
  const addError = add.error instanceof ApiError ? add.error : null;
  const remove = useMutation({ mutationFn: (id: string) => deleteChannelRule(id), onSuccess: refresh });

  const access = accessProblem(taxonomy.error);
  if (access)
    return (
      <AccessNotice problem={access} title="The taxonomy is for the marketing team">
        Editors, marketing managers and admins see channel rules and unmapped values.
      </AccessNotice>
    );
  if (taxonomy.isPending) return <SkeletonCard />;
  if (taxonomy.isError) return <Alert tone="danger" title="Taxonomy not loaded">{taxonomy.error.message}</Alert>;
  const { channels, rules, unmapped } = taxonomy.data;
  const channelName = (id: string) => channels.find((item) => item.id === id)?.name ?? id;
  const open = unmapped.filter((item) => !item.resolvedAt);

  const unmappedColumns: Column<UnmappedValue>[] = [
    { key: 'value', header: 'Value', render: (row) => <code>{row.value}</code>, sortValue: (row) => row.value },
    { key: 'source', header: 'Seen in', render: (row) => SOURCE_LABEL[row.source] ?? row.source },
    { key: 'count', header: 'Times seen', numeric: true, render: (row) => formatNumber(row.count), sortValue: (row) => row.count },
    { key: 'last', header: 'Last seen', render: (row) => <span className="num">{formatDate(row.lastSeenAt)}</span>, sortValue: (row) => row.lastSeenAt },
    { key: 'channel', header: 'Channel', render: (row) => <ResolveCell value={row} channels={channels} canEdit={canEdit} onDone={refresh} /> },
  ];
  const ruleColumns: Column<ChannelRule>[] = [
    { key: 'kind', header: 'Matches', render: (row) => KIND_LABEL[row.kind] },
    { key: 'value', header: 'Value', render: (row) => <code>{row.value}</code>, sortValue: (row) => row.value },
    { key: 'channel', header: 'Channel', render: (row) => channelName(row.channel), sortValue: (row) => channelName(row.channel) },
    {
      key: 'origin',
      header: 'Added by',
      render: (row) =>
        row.builtIn ? (
          <span className="muted">Built in</span>
        ) : (
          <div className="cluster">
            <span>{row.createdBy}</span>
            {canEdit && row.id && (
              <Button size="sm" variant="ghost" icon={<Trash size={16} aria-hidden />} loading={remove.isPending && remove.variables === row.id} onClick={() => remove.mutate(row.id!)}>
                Delete
              </Button>
            )}
          </div>
        ),
    },
  ];

  return (
    <div className="stack stack--lg">
      <section className="card stack" aria-labelledby="unmapped-heading">
        <div className="card__header">
          <h2 id="unmapped-heading">Unmapped values</h2>
          <StatusBadge tone={open.length ? 'warning' : 'success'}>{open.length ? `${formatNumber(open.length)} to review` : 'All mapped'}</StatusBadge>
        </div>
        <p className="muted">
          Campaign parameters and CRM labels that no rule matches. Their traffic and leads count as unmapped in every report, never as another channel. Mapping one adds a rule and
          updates the rows already stored.
        </p>
        <DataTable
          caption="Unmapped values"
          captionHidden
          columns={unmappedColumns}
          rows={unmapped}
          rowKey={(row) => row.id}
          empty="Nothing to review: every value seen so far maps to a channel."
        />
        {!canEdit && open.length > 0 && <p className="muted">A marketing manager or admin maps these values.</p>}
      </section>

      <section className="card stack" aria-labelledby="rules-heading">
        <h2 id="rules-heading">Channel rules</h2>
        <p className="muted">
          Rules apply in this order: source and medium together, then utm_medium, then utm_source; staff rules before built-in ones. Write source and medium as <code>source/medium</code>, for example{' '}
          <code>tiktok/influencer</code>. A visit with no parameters counts as Search and website.
        </p>
        {canEdit && (
          <form
            className="form-row form-row--end"
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate();
            }}
          >
            <SelectField label="Matches" value={kind} onChange={(event) => setKind(event.target.value as RuleKind)} options={Object.entries(KIND_LABEL).map(([key, label]) => ({ value: key, label }))} />
            <TextField
              label="Value"
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
              error={addError?.details.field === 'value' ? addError.message : undefined}
            />
            <SelectField
              label="Channel"
              required
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              options={[{ value: '', label: 'Choose a channel' }, ...channels.map((item) => ({ value: item.id, label: item.name }))]}
            />
            <Button type="submit" variant="secondary" disabled={!value.trim() || !channel} loading={add.isPending}>
              Add rule
            </Button>
          </form>
        )}
        {add.isError && addError?.details.field !== 'value' && <Alert tone="danger" title="Rule not added">{add.error.message}</Alert>}
        <DataTable caption="Channel rules" captionHidden columns={ruleColumns} rows={rules} rowKey={(row) => row.id ?? `${row.kind}:${row.value}`} />
      </section>
    </div>
  );
}
