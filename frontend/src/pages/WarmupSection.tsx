import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { updateWarmup, type SendingDomain, type Warmup, type WarmupLength } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { Disclosure } from '../motion';
import { Alert, Button, ConfirmDialog, DataTable, SelectField, StatusBadge, Tag, type Tone } from '../ui';

const STATUS: Record<Warmup['status'], { tone: Tone; label: string }> = {
  not_started: { tone: 'neutral', label: 'Not started' },
  active: { tone: 'warning', label: 'Warming up' },
  complete: { tone: 'success', label: 'Complete' },
  skipped: { tone: 'neutral', label: 'Skipped' },
};

const LENGTHS: { value: string; label: string }[] = [
  { value: '14', label: '2 weeks' },
  { value: '21', label: '3 weeks' },
  { value: '28', label: '4 weeks' },
];

function Summary({ warmup }: { warmup: Warmup }) {
  const first = formatNumber(warmup.plan[0] ?? 0);
  const last = formatNumber(warmup.plan.at(-1) ?? 0);
  switch (warmup.status) {
    case 'not_started':
      return (
        <p>
          Starts the day SPF, DKIM and DMARC first pass. Day 1 allows {first} marketing emails, day {warmup.days} allows{' '}
          {last}.
        </p>
      );
    case 'active': {
      const cap = warmup.todayCap ?? 0;
      const used = Math.min(100, cap === 0 ? 100 : (warmup.sentToday / cap) * 100);
      const tomorrow = warmup.day !== null && warmup.day < warmup.days ? warmup.plan[warmup.day] : null;
      return (
        <div className="stack stack--sm">
          <p className="warmup__day">
            Day <span className="num">{warmup.day}</span> of <span className="num">{warmup.days}</span>
          </p>
          <p>
            <strong className="num">{formatNumber(warmup.sentToday)}</strong> of{' '}
            <strong className="num">{formatNumber(cap)}</strong> marketing emails sent today
          </p>
          <span className="usage-bar" aria-hidden>
            <span className="usage-bar__fill" style={{ inlineSize: `${used}%` }} />
          </span>
          {tomorrow != null && <p className="muted">Tomorrow’s cap: {formatNumber(tomorrow)}.</p>}
        </div>
      );
    }
    case 'complete':
      return <p>Finished: marketing email from this domain has no daily cap.</p>;
    case 'skipped':
      return (
        <p>
          Skipped by an admin{warmup.skippedAt ? ` on ${formatDate(warmup.skippedAt)}` : ''}: marketing email from this
          domain has no daily cap.
        </p>
      );
  }
}

/**
 * EML-08: warm-up plan of a sending domain. Daily caps rise over two to four weeks; the send gate
 * stops marketing email at today's cap. Admins choose the length or skip the plan (logged).
 */
export function WarmupSection({
  domain,
  canManage,
  onUpdated,
}: {
  domain: SendingDomain;
  canManage: boolean;
  onUpdated: (domain: SendingDomain) => void;
}) {
  const { warmup } = domain;
  const [confirmSkip, setConfirmSkip] = useState(false);
  const change = useMutation({
    mutationFn: (body: { days: WarmupLength } | { skip: true }) => updateWarmup(domain.id, body),
    onSuccess: (updated) => {
      setConfirmSkip(false);
      onUpdated(updated);
    },
  });
  const headingId = `warmup-${domain.id}`;
  const status = STATUS[warmup.status];
  const editable = canManage && (warmup.status === 'not_started' || warmup.status === 'active');

  return (
    <section className="stack" aria-labelledby={headingId}>
      <div className="cluster">
        <h3 id={headingId}>Warm-up plan</h3>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>

      <div className="inset warmup">
        <div className="stack stack--sm">
          <Summary warmup={warmup} />
          <p className="muted warmup__note">
            When today’s cap is reached, marketing email waits until tomorrow (Yerevan time). Campaigns go to the most
            engaged contacts first once sending arrives in phase 1.
          </p>
        </div>
        {editable && (
          <div className="warmup__controls">
            <SelectField
              label="Plan length"
              options={LENGTHS}
              value={String(warmup.days)}
              disabled={change.isPending}
              onChange={(event) => change.mutate({ days: Number(event.target.value) as WarmupLength })}
            />
            <Button variant="secondary" size="sm" onClick={() => setConfirmSkip(true)}>
              Skip warm-up
            </Button>
          </div>
        )}
      </div>

      <div role="status" aria-live="polite">
        {change.isError && !confirmSkip && (
          <Alert tone="danger" title="The warm-up plan was not changed">
            {change.error.message}
          </Alert>
        )}
      </div>

      <Disclosure title={`Daily caps for all ${warmup.days} days`}>
        <DataTable
          caption={`Warm-up daily caps for ${domain.domain}`}
          captionHidden
          columns={[
            {
              key: 'day',
              header: 'Day',
              render: (row: { day: number; cap: number }) => (
                <span className="cluster">
                  <span className="num">Day {row.day}</span>
                  {warmup.status === 'active' && row.day === warmup.day && <Tag>Today</Tag>}
                </span>
              ),
            },
            { key: 'cap', header: 'Marketing emails', numeric: true, render: (row) => formatNumber(row.cap) },
          ]}
          rows={warmup.plan.map((cap, index) => ({ day: index + 1, cap }))}
          rowKey={(row) => String(row.day)}
        />
      </Disclosure>

      <ConfirmDialog
        open={confirmSkip}
        title={`Skip the warm-up for ${domain.domain}?`}
        confirmLabel="Skip warm-up"
        busy={change.isPending}
        onConfirm={() => change.mutate({ skip: true })}
        onCancel={() => setConfirmSkip(false)}
      >
        <p>
          Marketing email from {domain.domain} will have no daily cap from now on, and this cannot be undone. Skip only
          for a domain that already sends regularly with a good reputation: a new domain that sends at full volume can
          land in spam.
        </p>
        {change.isError && (
          <Alert tone="danger" title="The warm-up was not skipped">
            {change.error.message}
          </Alert>
        )}
      </ConfirmDialog>
    </section>
  );
}
