import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

function PageErrorMessage({ error }: { error: Error }) {
  const t = useT();
  return (
    <section className="card" role="alert">
      <EmptyState
        title={t('shell.pageError')}
        icon={<WarningCircle size={28} weight="bold" aria-hidden />}
        action={
          <Button variant="secondary" icon={<ArrowClockwise size={18} aria-hidden />} onClick={() => window.location.reload()}>
            {t('shell.reload')}
          </Button>
        }
      >
        {t('shell.pageErrorHint')} <code className="muted">{error.message}</code>
      </EmptyState>
    </section>
  );
}

/**
 * A page that fails to render shows a message inside the shell instead of a blank screen: navigation stays
 * usable and the next page renders normally (the boundary is keyed by the route).
 */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page failed to render', error, info.componentStack);
  }

  render() {
    return this.state.error ? <PageErrorMessage error={this.state.error} /> : this.props.children;
  }
}
