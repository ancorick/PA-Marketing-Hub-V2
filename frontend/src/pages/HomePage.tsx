import { ArrowClockwise } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../lib/api';
import { Alert, Button, PageHeader, Skeleton, StatusBadge, type Tone } from '../ui';

const MODULES = [
  { name: 'Audience', phase: 'Phase 1' },
  { name: 'Newsletter', phase: 'Phase 2' },
  { name: 'Analytics', phase: 'Phase 3' },
  { name: 'Event Hub', phase: 'Phase 4 (slot)' },
] as const;

function tone(value: string): Tone {
  if (value === 'ok') return 'success';
  if (value === 'embedded' || value === 'mock' || value === 'log') return 'warning';
  return 'danger';
}

/** Overview placeholder until ANL-08: shows API health and module status. */
export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth, retry: 1 });

  return (
    <>
      <PageHeader title="Overview" description="Headline tiles and the channel table arrive with Analytics (phase 3)." />
      <div className="grid grid--2">
        <section className="card" aria-labelledby="api-status-heading">
          <div className="card__header">
            <h2 id="api-status-heading">API status</h2>
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowClockwise size={16} aria-hidden />}
              loading={health.isFetching}
              onClick={() => void health.refetch()}
            >
              Check again
            </Button>
          </div>
          <div role="status" aria-live="polite" className="stack">
            {health.isPending && (
              <>
                <p className="muted">Checking the API. A sleeping Render free service can take up to a minute to wake.</p>
                <Skeleton height="1.25rem" width="60%" />
              </>
            )}
            {health.isError && (
              <Alert tone="danger" title="API unreachable">
                {health.error.message}. Check that the backend is running and VITE_API_URL points to it.
              </Alert>
            )}
            {health.isSuccess && (
              <dl className="dl-inline">
                <dt className="visually-hidden">API</dt>
                <dd>
                  <StatusBadge tone={health.data.status === 'ok' ? 'success' : 'warning'}>API {health.data.status}</StatusBadge>
                </dd>
                <dt className="visually-hidden">Database</dt>
                <dd>
                  <StatusBadge tone={tone(health.data.database)}>Database: {health.data.database.replace('_', ' ')}</StatusBadge>
                </dd>
                <dt className="visually-hidden">Email adapter</dt>
                <dd>
                  <StatusBadge tone={tone(health.data.email.adapter)}>Email: {health.data.email.adapter}</StatusBadge>
                </dd>
                <dt className="visually-hidden">Integrations</dt>
                <dd>
                  <StatusBadge tone={tone(health.data.integrations.mode)}>Integrations: {health.data.integrations.mode}</StatusBadge>
                </dd>
              </dl>
            )}
          </div>
        </section>
        <section className="card" aria-labelledby="modules-heading">
          <h2 id="modules-heading">Modules</h2>
          <ul className="stack list-reset">
            {MODULES.map((m) => (
              <li key={m.name} className="cluster spread">
                <span>{m.name}</span>
                <StatusBadge tone="neutral">Not built yet · {m.phase}</StatusBadge>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
