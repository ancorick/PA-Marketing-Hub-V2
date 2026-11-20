import { AnimatePresence, m } from 'motion/react';
import { lazy, Suspense } from 'react';
import { useHashRoute } from './lib/useHashRoute';
import { pageTransition } from './lib/motion';
import { EmailSettingsPage } from './pages/EmailSettingsPage';
import { HomePage } from './pages/HomePage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { AppShell, RoleSwitcher, SkeletonCard, ThemeSwitcher } from './ui';

/** The design-system preview is a dev aid with demo charts and data: keep it out of the main bundle. */
const DesignSystemPage = lazy(() => import('./pages/DesignSystemPage').then((mod) => ({ default: mod.DesignSystemPage })));
/** Audience screens load on first visit (route-level split keeps the main bundle small). */
const ContactsPage = lazy(() => import('./pages/ContactsPage').then((mod) => ({ default: mod.ContactsPage })));
const ContactPage = lazy(() => import('./pages/ContactPage').then((mod) => ({ default: mod.ContactPage })));
const NewContactPage = lazy(() => import('./pages/ContactPage').then((mod) => ({ default: mod.NewContactPage })));

/** Screens not built yet, with the PLAYBOOK phase that delivers them (PRD 5.4). */
const PLACEHOLDERS: Record<string, { title: string; phase: string }> = {
  '/newsletter': { title: 'Newsletter', phase: 'phase 2' },
  '/events': { title: 'Events', phase: 'phase 4' },
  '/analytics': { title: 'Analytics', phase: 'phase 3' },
  '/admin': { title: 'Users and roles', phase: 'phase 0' },
};

/** Staff shell. Layout and styling follow design-system/marketing-hub/MASTER.md. */
export function App() {
  const path = useHashRoute();
  const placeholder = PLACEHOLDERS[path];
  const contactId = path.match(/^\/audience\/contacts\/([^/]+)$/)?.[1];
  const audience = path === '/audience' || contactId !== undefined;
  const known = placeholder || audience || path === '/design-system' || path === '/email-settings' ? path : '/';

  let page;
  if (path === '/design-system') page = <DesignSystemPage />;
  else if (path === '/email-settings') page = <EmailSettingsPage />;
  else if (path === '/audience') page = <ContactsPage />;
  else if (contactId === 'new') page = <NewContactPage />;
  else if (contactId !== undefined) page = <ContactPage key={contactId} id={decodeURIComponent(contactId)} />;
  else if (placeholder) page = <PlaceholderPage title={placeholder.title} phase={placeholder.phase} />;
  else page = <HomePage />;

  return (
    <AppShell currentPath={known} headerEnd={
        <>
          <RoleSwitcher />
          <ThemeSwitcher />
        </>
      }>
      {/* Page change: short crossfade; the old page leaves faster than the new one arrives. */}
      <AnimatePresence mode="wait" initial={false}>
        <m.div key={known} {...pageTransition}>
          <Suspense fallback={<SkeletonCard />}>{page}</Suspense>
        </m.div>
      </AnimatePresence>
    </AppShell>
  );
}
