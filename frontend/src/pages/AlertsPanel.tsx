import { Bell } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAlerts, resolveAlert, type StaffAlert } from '../lib/api';
import { formatDate } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { Alert, Button } from '../ui';

/** Open alerts for the signed-in role (PRD 7.4 guardrails, 14.4 job failures). */
export function AlertsPanel() {
  const role = useStaffRole();
  const canResolve = role === 'admin' || role === 'marketing_manager';
  const queryClient = useQueryClient();
  const alerts = useQuery({ queryKey: ['alerts', role], queryFn: listAlerts, refetchInterval: 60_000 });
  const resolve = useMutation({ mutationFn: (id: string) => resolveAlert(id), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alerts'] }) });
  const open = alerts.data?.alerts ?? [];
  if (open.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby="alerts-heading">
      <div className="cluster">
        <span className="icon-tile icon-tile--sm icon-tile--brand">
          <Bell size={20} weight="bold" aria-hidden />
        </span>
        <h2 id="alerts-heading">Needs attention</h2>
        <span className="badge badge--brand num">{open.length}</span>
      </div>
      {open.map((alert: StaffAlert) => (
        <Alert
          key={alert.id}
          tone={alert.level === 'critical' ? 'danger' : 'warning'}
          title={alert.title}
          action={
            <div className="cluster">
              {alert.link && (
                <a className="btn btn--secondary btn--sm" href={alert.link}>
                  Open
                </a>
              )}
              {canResolve && (
                <Button size="sm" variant="ghost" loading={resolve.isPending && resolve.variables === alert.id} onClick={() => resolve.mutate(alert.id)}>
                  Resolve
                </Button>
              )}
            </div>
          }
        >
          {alert.message} <span className="muted">({formatDate(alert.createdAt, undefined, { timeStyle: 'short' })})</span>
        </Alert>
      ))}
    </section>
  );
}
