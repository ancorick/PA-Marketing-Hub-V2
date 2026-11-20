import { useSyncExternalStore } from 'react';

/** Marketing Hub roles (PRD 4.3), mirrored from the backend Core Engine contract. */
export type StaffRole = 'viewer' | 'editor' | 'marketing_manager' | 'admin' | 'leadership';

export const STAFF_ROLES: { value: StaffRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'marketing_manager', label: 'Marketing manager' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'leadership', label: 'Leadership' },
];

/**
 * Mock sign-in until the Core Engine (Project 1) provides real staff sessions (NFR-S1, manual task 7).
 * The backend in INTEGRATIONS_MODE=mock accepts "mock-<role>" tokens and checks the role on every request.
 * Per tab (sessionStorage), so two tabs can compare roles side by side.
 */
const STORAGE_KEY = 'mh-mock-role';
const listeners = new Set<() => void>();

function read(): StaffRole {
  const saved = sessionStorage.getItem(STORAGE_KEY);
  return STAFF_ROLES.some((role) => role.value === saved) ? (saved as StaffRole) : 'admin';
}

export function setMockRole(role: StaffRole) {
  sessionStorage.setItem(STORAGE_KEY, role);
  listeners.forEach((listener) => listener());
}

export function staffToken(): string {
  return `mock-${read()}`;
}

export function useStaffRole(): StaffRole {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => 'admin' as const,
  );
}
