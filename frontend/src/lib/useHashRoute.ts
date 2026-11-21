import { useSyncExternalStore } from 'react';

/**
 * Minimal hash routing for the scaffold ("#/contacts" → "/audience").
 * A real router is chosen in PLAYBOOK step 4 together with the first module screens.
 */
function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function read(): string {
  const path = window.location.hash.replace(/^#/, '');
  return path.startsWith('/') ? path : '/';
}

export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, read, () => '/');
}
