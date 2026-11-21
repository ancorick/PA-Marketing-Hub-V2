import { LinkSimple } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, createTrackedLink, listTrackedLinks, type TrackedLink } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, Button, CopyButton, DataTable, SelectField, SkeletonCard, TextField, type Column } from '../../ui';

const EMPTY = { destinationUrl: '', channel: '', source: '', campaign: '', content: '', label: '' };

/** Campaign link builder (PRD 9.3, ANL-04): staff pick a channel and campaign; the parameters are written for them. */
export function LinksSection() {
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const links = useQuery({ queryKey: ['tracked-links', role], queryFn: listTrackedLinks });
  const [form, setForm] = useState(EMPTY);
  const set = (key: keyof typeof EMPTY) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const create = useMutation({
    mutationFn: () => createTrackedLink({ ...form, content: form.content || null, label: form.label || null }),
    onSuccess: () => {
      setForm((current) => ({ ...EMPTY, channel: current.channel, source: current.source, campaign: current.campaign }));
      void queryClient.invalidateQueries({ queryKey: ['tracked-links'] });
    },
  });
  const error = create.error instanceof ApiError ? create.error : null;
  const fieldError = (name: string) => (error?.details.field === name ? error.message : undefined);

  const access = accessProblem(links.error);
  if (access)
    return (
      <AccessNotice problem={access} title="The link builder is for the marketing team">
        Editors, marketing managers and admins create tracked links.
      </AccessNotice>
    );
  if (links.isPending) return <SkeletonCard />;
  if (links.isError) return <Alert tone="danger" title="Links not loaded">{links.error.message}</Alert>;
  const { channels, campaigns } = links.data;
  const channel = channels.find((item) => item.id === form.channel);
  const channelName = (id: string) => channels.find((item) => item.id === id)?.name ?? id;
  const created = create.data;

  const columns: Column<TrackedLink>[] = [
    {
      key: 'link',
      header: 'Link',
      render: (row) => (
        <div className="stack stack--xs">
          <span>{row.label ?? row.destinationUrl}</span>
          <span className="cluster cluster--nowrap">
            <code className="muted">{row.shortUrl}</code>
            <CopyButton value={row.shortUrl} label={`Copy short link ${row.shortUrl}`} />
          </span>
        </div>
      ),
      sortValue: (row) => row.label ?? row.destinationUrl,
    },
    { key: 'channel', header: 'Channel', render: (row) => channelName(row.channel), sortValue: (row) => channelName(row.channel) },
    { key: 'campaign', header: 'Campaign', render: (row) => <code>{row.utmCampaign}</code>, sortValue: (row) => row.utmCampaign },
    { key: 'source', header: 'Source / medium', render: (row) => <code>{`${row.utmSource} / ${row.utmMedium}`}</code> },
    { key: 'clicks', header: 'Short link clicks', numeric: true, render: (row) => formatNumber(row.clicks), sortValue: (row) => row.clicks },
    { key: 'created', header: 'Created', render: (row) => <span className="num">{formatDate(row.createdAt)}</span>, sortValue: (row) => row.createdAt },
  ];

  return (
    <div className="stack stack--lg">
      <section className="card stack" aria-labelledby="builder-heading">
        <div className="cluster">
          <span className="icon-tile icon-tile--sm icon-tile--brand">
            <LinkSimple size={20} weight="bold" aria-hidden />
          </span>
          <h2 id="builder-heading">New tracked link</h2>
        </div>
        <p className="muted">Choose the channel and campaign; the campaign parameters come from the channel taxonomy, so every visit lands in the right channel.</p>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <TextField label="Page address" required type="url" placeholder="https://" value={form.destinationUrl} onChange={set('destinationUrl')} error={fieldError('destinationUrl')} />
          <div className="form-row">
            <SelectField
              label="Channel"
              required
              value={form.channel}
              onChange={set('channel')}
              options={[{ value: '', label: 'Choose a channel' }, ...channels.map((item) => ({ value: item.id, label: item.name }))]}
              hint={channel ? `utm_medium: ${channel.medium}` : undefined}
            />
            <TextField label="Source" required list="link-sources" value={form.source} onChange={set('source')} error={fieldError('source')} hint="Where the link is posted, e.g. instagram" />
            <TextField label="Campaign" required list="link-campaigns" value={form.campaign} onChange={set('campaign')} error={fieldError('campaign')} hint="Reuse a name to group links" />
          </div>
          <div className="form-row">
            <TextField label="Content" value={form.content} onChange={set('content')} hint="Optional: tells two ads or posts apart" />
            <TextField label="Note for the team" value={form.label} onChange={set('label')} hint="Optional, e.g. Story ad, week 2" />
          </div>
          <datalist id="link-sources">
            {(channel?.sources ?? []).map((source) => (
              <option key={source} value={source} />
            ))}
          </datalist>
          <datalist id="link-campaigns">
            {campaigns.map((campaign) => (
              <option key={campaign} value={campaign} />
            ))}
          </datalist>
          <div className="cluster">
            <Button type="submit" variant="primary" loading={create.isPending} disabled={!form.destinationUrl || !form.channel || !form.source.trim() || !form.campaign.trim()}>
              Create link
            </Button>
          </div>
          {error && !error.details.field && <Alert tone="danger" title="Link not created">{error.message}</Alert>}
        </form>
        {created && (
          <div className="inset stack stack--sm" role="status">
            <strong>Link ready</strong>
            <span className="cluster cluster--nowrap">
              <code>{created.shortUrl}</code>
              <CopyButton value={created.shortUrl} label="Copy short link" />
            </span>
            <span className="cluster cluster--nowrap">
              <code className="muted block-body">{created.fullUrl}</code>
              <CopyButton value={created.fullUrl} label="Copy full tracked URL" />
            </span>
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="links-heading">
        <h2 id="links-heading">Tracked links</h2>
        <DataTable
          caption="Tracked links"
          captionHidden
          columns={columns}
          rows={links.data.links}
          rowKey={(row) => row.id}
          initialSort={{ key: 'created', direction: 'descending' }}
          empty="No tracked links yet. Create one above before posting a campaign link."
        />
      </section>
    </div>
  );
}
