import { HandPalm, Play } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getKillSwitch, setKillSwitch } from '../lib/api';
import { formatDate } from '../lib/format';
import { useT } from '../lib/i18n';
import { useStaffRole } from '../lib/session';
import { Alert, Button, ConfirmDialog, TextField } from '../ui';

/** Kill-switch state for the signed-in role; viewers and leadership cannot read it. */
export function useKillSwitch() {
  const role = useStaffRole();
  return useQuery({ queryKey: ['kill-switch', role], queryFn: getKillSwitch, enabled: role !== 'viewer' && role !== 'leadership' });
}

/** EML-14: one button that pauses every marketing send (or resumes them); marketing managers and admins only. */
export function KillSwitchButton() {
  const t = useT();
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const state = useKillSwitch();
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
  if (!state.data || (role !== 'admin' && role !== 'marketing_manager')) return null;

  return (
    <>
      {state.data.paused ? (
        <Button className="no-print" variant="primary" icon={<Play size={18} weight="bold" aria-hidden />} loading={toggle.isPending} onClick={() => toggle.mutate(false)}>
          {t('es.killResume')}
        </Button>
      ) : (
        <Button className="no-print" variant="danger" icon={<HandPalm size={18} weight="bold" aria-hidden />} onClick={() => setConfirming(true)}>
          {t('es.killPause')}
        </Button>
      )}
      <ConfirmDialog open={confirming} title={t('es.killTitle')} confirmLabel={t('es.killPause')} busy={toggle.isPending} onConfirm={() => toggle.mutate(true)} onCancel={() => setConfirming(false)}>
        <p>{t('es.killBody')}</p>
        <TextField label={t('es.killReason')} required value={reason} onChange={(event) => setReason(event.target.value)} />
        {toggle.isError && <Alert tone="danger" title={t('nl.notSaved')}>{toggle.error.message}</Alert>}
      </ConfirmDialog>
    </>
  );
}

/** Banner on the send screens while the switch is on; `link` points to Email settings, where it is switched off. */
export function KillSwitchBanner({ link = true }: { link?: boolean }) {
  const t = useT();
  const state = useKillSwitch();
  if (!state.data?.paused) return null;
  const { by, at, reason } = state.data;
  return (
    <Alert
      tone="danger"
      title={t('es.killPaused')}
      action={link ? <a className="btn btn--secondary btn--sm" href="#/email-settings">{t('nav.emailSettings')}</a> : undefined}
    >
      {t('es.killPausedBy', { by: by ?? '', reason: `${at ? `, ${formatDate(at, undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}${reason ? `: ${reason}` : ''}` })}
    </Alert>
  );
}
