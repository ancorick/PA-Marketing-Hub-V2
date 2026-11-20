import { HandPalm } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getKillSwitch, setKillSwitch } from '../lib/api';
import { formatDate } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { Alert, Button, ConfirmDialog, TextField } from '../ui';

/** EML-14: one switch that pauses every marketing send; marketing managers and admins only. */
export function KillSwitchPanel() {
  const role = useStaffRole();
  const canSwitch = role === 'admin' || role === 'marketing_manager';
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ['kill-switch', role], queryFn: getKillSwitch, enabled: role !== 'viewer' && role !== 'leadership' });
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const toggle = useMutation({
    mutationFn: (paused: boolean) => setKillSwitch(paused, paused ? reason : null),
    onSuccess: (next) => {
      queryClient.setQueryData(['kill-switch', role], next);
      void queryClient.invalidateQueries({ queryKey: ['kill-switch'] });
      setConfirming(false);
      setReason('');
    },
  });
  if (!state.data) return null;
  const paused = state.data.paused;

  return (
    <section className="card stack" aria-labelledby="kill-switch-heading">
      <div className="card__header">
        <div className="cluster">
          <span className="icon-tile icon-tile--sm icon-tile--brand">
            <HandPalm size={20} weight="bold" aria-hidden />
          </span>
          <h2 id="kill-switch-heading">Kill switch</h2>
        </div>
        {canSwitch &&
          (paused ? (
            <Button variant="primary" loading={toggle.isPending} onClick={() => toggle.mutate(false)}>
              Resume sending
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Pause all sending
            </Button>
          ))}
      </div>
      {paused ? (
        <Alert tone="danger" title="All marketing sending is paused">
          Paused by {state.data.by} {state.data.at ? `on ${formatDate(state.data.at, undefined, { timeStyle: 'short' })}` : ''}
          {state.data.reason ? `: ${state.data.reason}` : ''}. Scheduled campaigns wait; nothing is lost.
        </Alert>
      ) : (
        <p className="muted">Sending runs normally. Pausing stops every campaign and newsletter within a minute; transactional email from other projects is not affected.</p>
      )}
      <ConfirmDialog
        open={confirming}
        title="Pause all marketing sending?"
        confirmLabel="Pause all sending"
        busy={toggle.isPending}
        onConfirm={() => toggle.mutate(true)}
        onCancel={() => setConfirming(false)}
      >
        <p>Every campaign and newsletter stops before its next message. They continue where they stopped when sending resumes.</p>
        <TextField label="Reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
      </ConfirmDialog>
    </section>
  );
}

/** Banner on the campaign screens while the switch is on. */
export function KillSwitchBanner() {
  const role = useStaffRole();
  const state = useQuery({ queryKey: ['kill-switch', role], queryFn: getKillSwitch });
  if (!state.data?.paused) return null;
  return (
    <Alert tone="danger" title="All marketing sending is paused" action={<a className="btn btn--secondary btn--sm" href="#/email-settings">Email settings</a>}>
      {state.data.reason ?? 'The kill switch is on.'}
    </Alert>
  );
}
