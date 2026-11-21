import { Coins, PencilSimple, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, createCost, deleteCost, listAnalyticsChannels, listCosts, listTrackedLinks, updateCost, type ChannelCost, type ManualCost } from '../../lib/api';
import { formatAmd, formatDate, formatNumber } from '../../lib/format';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, Button, ConfirmDialog, DataTable, SelectField, TextField, type Column } from '../../ui';
import { PeriodPicker, usePeriod, yerevanToday } from './period';

const blank = () => ({ channel: '', campaign: '', description: '', dateFrom: yerevanToday(), dateTo: yerevanToday(), amount: '', currency: 'AMD' });
const range = (cost: ManualCost) => (cost.dateFrom === cost.dateTo ? formatDate(cost.dateFrom) : `${formatDate(cost.dateFrom)} – ${formatDate(cost.dateTo)}`);

/** Manual cost entry (ANL-05, Flow D step 1) and channel cost for the period (9.5). */
export function CostsSection() {
  const role = useStaffRole();
  const canEdit = role === 'admin' || role === 'marketing_manager';
  const queryClient = useQueryClient();
  const [period, setPeriod] = usePeriod();
  const costs = useQuery({ queryKey: ['costs', role, period], queryFn: () => listCosts(period) });
  const channels = useQuery({ queryKey: ['analytics-channels', role], queryFn: listAnalyticsChannels });
  const campaigns = useQuery({ queryKey: ['tracked-links', role], queryFn: listTrackedLinks, enabled: canEdit });
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<ManualCost | null>(null);
  const [deleting, setDeleting] = useState<ManualCost | null>(null);
  const set = (key: keyof ReturnType<typeof blank>) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['costs'] });
  const save = useMutation({
    mutationFn: () => {
      const input = { ...form, campaign: form.campaign.trim() || null, amount: Number(form.amount.replace(/\s/g, '').replace(',', '.')) };
      return editing ? updateCost(editing.id, input) : createCost(input);
    },
    onSuccess: () => {
      setEditing(null);
      setForm(blank());
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCost(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const error = save.error instanceof ApiError ? save.error : null;
  const fieldError = (name: string) => (error?.details.field === name ? error.message : undefined);
  const channelName = (id: string) => channels.data?.channels.find((item) => item.id === id)?.name ?? id;
  const startEdit = (cost: ManualCost) => {
    setEditing(cost);
    setForm({ channel: cost.channel, campaign: cost.campaign ?? '', description: cost.description, dateFrom: cost.dateFrom, dateTo: cost.dateTo, amount: cost.originalAmount, currency: cost.currency });
    document.getElementById('cost-form-heading')?.scrollIntoView({ block: 'start' });
  };

  const access = accessProblem(costs.error);
  if (access)
    return (
      <AccessNotice problem={access} title="Costs are for signed-in staff">
        Sign in to see channel costs.
      </AccessNotice>
    );

  const summary = costs.data?.channels ?? [];
  const totals = summary.reduce((sum, row) => ({ ad: sum.ad + row.adSpendAmd, manual: sum.manual + row.manualAmd, total: sum.total + row.totalAmd }), { ad: 0, manual: 0, total: 0 });
  const summaryColumns: Column<ChannelCost>[] = [
    { key: 'channel', header: 'Channel', render: (row) => channelName(row.channel), sortValue: (row) => channelName(row.channel) },
    { key: 'ad', header: 'Ad spend', numeric: true, render: (row) => formatAmd(row.adSpendAmd), sortValue: (row) => row.adSpendAmd },
    { key: 'manual', header: 'Manual costs', numeric: true, render: (row) => formatAmd(row.manualAmd), sortValue: (row) => row.manualAmd },
    { key: 'total', header: 'Channel cost', numeric: true, render: (row) => <strong>{formatAmd(row.totalAmd)}</strong>, sortValue: (row) => row.totalAmd },
  ];
  const entryColumns: Column<ManualCost>[] = [
    {
      key: 'description',
      header: 'Cost',
      render: (row) => (
        <div className="stack stack--xs">
          <span>{row.description}</span>
          <span className="muted">
            {channelName(row.channel)}
            {row.campaign && (
              <>
                {' · '}
                <code>{row.campaign}</code>
              </>
            )}
          </span>
        </div>
      ),
      sortValue: (row) => row.description,
    },
    { key: 'dates', header: 'Spend dates', render: (row) => <span className="num">{range(row)}</span>, sortValue: (row) => row.dateFrom },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      render: (row) => (
        <div className="stack stack--xs">
          <span>{formatAmd(row.amountAmd)}</span>
          {row.currency !== 'AMD' && (
            <span className="muted">
              {formatNumber(Number(row.originalAmount), undefined, { minimumFractionDigits: 2 })} {row.currency} at {formatNumber(row.rateToAmd)}
            </span>
          )}
        </div>
      ),
      sortValue: (row) => row.amountAmd,
    },
    { key: 'by', header: 'Entered by', render: (row) => row.updatedBy },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: 'Actions',
            render: (row: ManualCost) => (
              <div className="cluster cluster--nowrap">
                <Button size="sm" variant="ghost" icon={<PencilSimple size={16} aria-hidden />} onClick={() => startEdit(row)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash size={16} aria-hidden />} onClick={() => setDeleting(row)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="stack stack--lg">
      <PeriodPicker period={period} onChange={setPeriod} />
      {costs.isError && <Alert tone="danger" title="Costs not loaded">{costs.error.message}</Alert>}
      <section className="card stack" aria-labelledby="channel-cost-heading">
        <h2 id="channel-cost-heading">Channel cost in the period</h2>
        <p className="muted">Ad spend from the ad platforms plus manual costs, spread evenly over their spend dates. Amounts in AMD; cash costs only (staff time is not included).</p>
        <DataTable
          caption="Channel cost in the period"
          captionHidden
          columns={summaryColumns}
          rows={summary}
          rowKey={(row) => row.channel}
          loading={costs.isPending}
          initialSort={{ key: 'total', direction: 'descending' }}
          footer={
            <tr>
              <th scope="row">Total</th>
              <td className="is-num">{formatAmd(totals.ad)}</td>
              <td className="is-num">{formatAmd(totals.manual)}</td>
              <td className="is-num">
                <strong>{formatAmd(totals.total)}</strong>
              </td>
            </tr>
          }
        />
      </section>

      {canEdit && (
        <section className="card stack" aria-labelledby="cost-form-heading">
          <div className="cluster">
            <span className="icon-tile icon-tile--sm icon-tile--brand">
              <Coins size={20} weight="bold" aria-hidden />
            </span>
            <h2 id="cost-form-heading">{editing ? 'Edit cost' : 'Add a cost'}</h2>
          </div>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div className="form-row">
              <TextField label="What it is for" required value={form.description} onChange={set('description')} error={fieldError('description')} hint="e.g. Agency fee, October" />
              <SelectField
                label="Channel"
                required
                value={form.channel}
                onChange={set('channel')}
                error={fieldError('channel')}
                options={[{ value: '', label: 'Choose a channel' }, ...(channels.data?.channels ?? []).map((item) => ({ value: item.id, label: item.name }))]}
              />
              <TextField label="Campaign" list="cost-campaigns" value={form.campaign} onChange={set('campaign')} hint="Optional: credits the cost to one campaign" />
            </div>
            <div className="form-row">
              <TextField label="First day" type="date" required value={form.dateFrom} onChange={set('dateFrom')} error={fieldError('dateFrom')} />
              <TextField label="Last day" type="date" required value={form.dateTo} min={form.dateFrom} onChange={set('dateTo')} error={fieldError('dateTo')} />
              <TextField label="Amount" required inputMode="decimal" value={form.amount} onChange={set('amount')} error={fieldError('amount')} />
              <SelectField
                label="Currency"
                required
                value={form.currency}
                onChange={set('currency')}
                error={fieldError('currency')}
                hint={form.currency === 'AMD' ? undefined : 'Converted at the Central Bank of Armenia rate on the first day'}
                options={(costs.data?.currencies ?? ['AMD']).map((code) => ({ value: code, label: code }))}
              />
            </div>
            <datalist id="cost-campaigns">
              {(campaigns.data?.campaigns ?? []).map((campaign) => (
                <option key={campaign} value={campaign} />
              ))}
            </datalist>
            <div className="cluster">
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!form.description.trim() || !form.channel || !form.amount}>
                {editing ? 'Save changes' : 'Add cost'}
              </Button>
              {editing && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setForm(blank());
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
            {error && !error.details.field && <Alert tone="danger" title="Cost not saved">{error.message}</Alert>}
          </form>
        </section>
      )}

      <section className="card stack" aria-labelledby="cost-entries-heading">
        <h2 id="cost-entries-heading">Manual costs in the period</h2>
        <DataTable
          caption="Manual costs in the period"
          captionHidden
          columns={entryColumns}
          rows={costs.data?.costs ?? []}
          rowKey={(row) => row.id}
          loading={costs.isPending}
          empty={canEdit ? 'No manual costs in this period. Add agency fees, printed materials, sponsorships or venue costs above.' : 'No manual costs in this period.'}
        />
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this cost?"
        confirmLabel="Delete cost"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      >
        <p>
          {deleting?.description} ({deleting && formatAmd(deleting.amountAmd)}) stops counting toward {deleting && channelName(deleting.channel)} in every report. The entry is kept
          with your name for the record.
        </p>
        {remove.isError && <Alert tone="danger" title="Not deleted">{remove.error.message}</Alert>}
      </ConfirmDialog>
    </div>
  );
}
