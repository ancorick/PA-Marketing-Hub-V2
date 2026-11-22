import { BellRinging, CheckCircle } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { listAlertsWithResolved, resolveAlert, type StaffAlert } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, Button, Chip, EmptyState, PageHeader, retryServerErrors, SkeletonCard, SkeletonTile, StatTile, StatusBadge } from '../../ui';
import { PrintButton, useDateTimeLabel } from '../measure/shared';

type Show = 'open' | 'resolved' | 'all';
const SHOWS: Show[] = ['open', 'resolved', 'all'];

/**
 * Alerts (PRD 7.4 guardrails, 14.4 job failures; RESTRUCTURE R5): every alert for the signed-in role with its
 * level, when it was raised and, once closed, who closed it. Open ones also drive the badge in the sidebar.
 */
export function AlertsPage() {
  const t = useT();
  const role = useStaffRole();
  const dateTime = useDateTimeLabel();
  const queryClient = useQueryClient();
  const [show, setShow] = useState<Show>('open');
  const canResolve = role === 'admin' || role === 'marketing_manager';
  const alerts = useQuery({ queryKey: ['alerts', role, 'history'], queryFn: listAlertsWithResolved, refetchInterval: 60_000, retry: retryServerErrors });
  const resolve = useMutation({
    mutationFn: (id: string) => resolveAlert(id),
    // ['alerts'] covers the sidebar badge too, so the number drops at once.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const access = accessProblem(alerts.error);
  const all = alerts.data?.alerts ?? [];
  const open = all.filter((alert) => !alert.resolvedAt);
  const resolved = all.filter((alert) => alert.resolvedAt);
  const critical = open.filter((alert) => alert.level === 'critical').length;
  const shown = show === 'open' ? open : show === 'resolved' ? resolved : all;

  return (
    <>
      <PageHeader title={t('nav.alerts')} description={t('al.description')} actions={<PrintButton disabled={all.length === 0} />} />
      {access ? (
        <AccessNotice problem={access} title={t('s.notLoaded')}>
          {t('al.managersOnly')}
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          {(alerts.isError || resolve.isError) && <Alert tone="danger" title={t('s.notLoaded')}>{(alerts.error ?? resolve.error)?.message}</Alert>}
          <div className="grid-12">
            {alerts.isPending ? (
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="span-3">
                  <SkeletonTile />
                </div>
              ))
            ) : (
              <>
                <div className="span-3">
                  <StatTile tone="yellow" label={t('al.tileOpen')} value={formatNumber(open.length)} caption={t('al.tileOpenCaption')} definition={t('al.tileOpenDefinition')} higherIsBetter={false} />
                </div>
                <div className="span-3">
                  <StatTile label={t('al.tileCritical')} value={formatNumber(critical)} caption={t('al.tileCriticalCaption')} definition={t('al.tileCriticalDefinition')} higherIsBetter={false} />
                </div>
                <div className="span-3">
                  <StatTile label={t('al.tileWarning')} value={formatNumber(open.length - critical)} caption={t('al.tileWarningCaption')} definition={t('al.tileWarningDefinition')} higherIsBetter={false} />
                </div>
                <div className="span-3">
                  <StatTile label={t('al.tileResolved')} value={formatNumber(resolved.length)} caption={t('al.tileResolvedCaption')} definition={t('al.tileResolvedDefinition')} />
                </div>
              </>
            )}
          </div>
          <section className="card stack" aria-labelledby="alerts-heading">
            <div className="card__header">
              <h2 id="alerts-heading">{t('al.list')}</h2>
              <div className="cluster no-print" role="group" aria-label={t('al.filter')}>
                {SHOWS.map((value) => (
                  <Chip key={value} selected={show === value} count={value === 'open' ? open.length : value === 'resolved' ? resolved.length : all.length} onClick={() => setShow(value)}>
                    {t(value === 'open' ? 'al.filterOpen' : value === 'resolved' ? 'al.filterResolved' : 'al.filterAll')}
                  </Chip>
                ))}
              </div>
            </div>
            {alerts.isPending ? (
              <SkeletonCard />
            ) : shown.length === 0 ? (
              show === 'resolved' ? (
                <EmptyState title={t('al.emptyResolved')} icon={<CheckCircle size={28} weight="bold" aria-hidden />} />
              ) : (
                <EmptyState title={t('al.emptyOpen')} icon={<BellRinging size={28} weight="bold" aria-hidden />}>
                  {t('al.emptyOpenHint')}
                </EmptyState>
              )
            ) : (
              <ul className="list-reset" aria-label={t('al.list')}>
                {shown.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} canResolve={canResolve} busy={resolve.isPending && resolve.variables === alert.id} onResolve={() => resolve.mutate(alert.id)} when={dateTime} />
                ))}
              </ul>
            )}
            {!canResolve && open.length > 0 && <p className="muted">{t('al.managersOnly')}</p>}
          </section>
        </div>
      )}
    </>
  );
}

function AlertRow({ alert, canResolve, busy, onResolve, when }: { alert: StaffAlert; canResolve: boolean; busy: boolean; onResolve: () => void; when: (iso: string) => string }) {
  const t = useT();
  const closed = alert.resolvedAt !== null;
  return (
    <li className="alert-row">
      <StatusBadge tone={closed ? 'neutral' : alert.level === 'critical' ? 'danger' : 'warning'}>{closed ? t('al.resolved') : t(`al.level.${alert.level}`)}</StatusBadge>
      <div className="stack stack--xs">
        <span className="alert-row__title">{alert.title}</span>
        <span className="text-wrap">{alert.message}</span>
        <span className="alert-row__meta num">
          {t('al.raised', { at: when(alert.createdAt) })}
          {closed && alert.resolvedAt ? ` · ${t('al.resolvedBy', { by: alert.resolvedBy ?? '—', at: when(alert.resolvedAt) })}` : ''}
          {closed ? ` · ${t(`al.level.${alert.level}`)}` : ''}
        </span>
      </div>
      <div className="cluster no-print">
        {alert.link && (
          <a className="btn btn--secondary btn--sm" href={alert.link}>
            {t('s.open')}
            <span className="visually-hidden">: {alert.title}</span>
          </a>
        )}
        {!closed && canResolve && (
          <Button size="sm" variant="ghost" loading={busy} aria-label={t('al.resolveFor', { title: alert.title })} onClick={onResolve}>
            {t('al.resolve')}
          </Button>
        )}
      </div>
    </li>
  );
}
