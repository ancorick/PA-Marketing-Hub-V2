import { LockSimple } from '@phosphor-icons/react';
import { ApiError } from '../lib/api';
import { EmptyState } from './EmptyState';

/** 401 = no staff session, 403 = the role may not use this screen; null for any other outcome. */
export function accessProblem(error: unknown): 401 | 403 | null {
  if (!(error instanceof ApiError)) return null;
  return error.status === 401 || error.status === 403 ? error.status : null;
}

/** A 4xx answer (no session, wrong role, bad input) will not change on retry. */
export const retryServerErrors = (failures: number, error: Error) =>
  !(error instanceof ApiError && error.status < 500) && failures < 1;

/** Explains why a screen is empty for this person instead of hiding it (PRD 13.7). */
export function AccessNotice({ problem, title, children }: { problem: 401 | 403; title: string; children: string }) {
  return (
    <section className="card">
      {problem === 401 ? (
        <EmptyState title="Sign-in is not available yet" icon={<LockSimple size={28} weight="bold" aria-hidden />}>
          Staff sign-in arrives with the Core Engine. Until then this API only accepts mock roles where
          ALLOW_MOCK_SIGN_IN is on (local development).
        </EmptyState>
      ) : (
        <EmptyState title={title} icon={<LockSimple size={28} weight="bold" aria-hidden />}>
          {children}
        </EmptyState>
      )}
    </section>
  );
}
