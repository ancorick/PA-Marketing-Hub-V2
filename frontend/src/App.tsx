import { useQuery } from '@tanstack/react-query';
import { getHealth } from './lib/api';

/**
 * Scaffold shell. The real layout, navigation and styling come from the design system (PLAYBOOK step 3).
 * Module slots: Audience, Newsletter, Analytics, Event Hub (PRD 5.1).
 */
const MODULES = ['Audience', 'Newsletter', 'Analytics', 'Event Hub'] as const;

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth, retry: 1 });

  return (
    <main>
      <h1>Marketing Hub</h1>
      <section aria-labelledby="api-status-heading">
        <h2 id="api-status-heading">API status</h2>
        <p role="status" aria-live="polite">
          {health.isPending && 'Checking the API… (a sleeping Render free service can take up to a minute to wake)'}
          {health.isError && `API unreachable: ${health.error.message}`}
          {health.isSuccess &&
            `API ${health.data.status}; database: ${health.data.database}; email adapter: ${health.data.email.adapter}; integrations: ${health.data.integrations.mode}`}
        </p>
      </section>
      <section aria-labelledby="modules-heading">
        <h2 id="modules-heading">Modules</h2>
        <ul>
          {MODULES.map((name) => (
            <li key={name}>{name}: not built yet</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
