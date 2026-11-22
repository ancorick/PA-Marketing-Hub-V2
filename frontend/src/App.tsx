import { AnimatePresence, m } from 'motion/react';
import { lazy, Suspense, useEffect } from 'react';
import { useHashRoute } from './lib/useHashRoute';
import { pageTransition } from './lib/motion';
import { HomePage } from './pages/HomePage';
import type { Stage } from './lib/api';
import { redirectFor, SHOW_DEV_TOOLS } from './lib/routes';
import { AppShell, PageErrorBoundary, SkeletonCard } from './ui';

/** The design-system preview is a dev aid with demo charts and data: keep it out of the main bundle. */
const DesignSystemPage = lazy(() => import('./pages/DesignSystemPage').then((mod) => ({ default: mod.DesignSystemPage })));
/** Audience screens load on first visit (route-level split keeps the main bundle small). */
/** REACH pages rebuilt in RESTRUCTURE R4. */
const ContactsPage = lazy(() => import('./pages/reach/ContactsPage').then((mod) => ({ default: mod.ContactsPage })));
const ContactPage = lazy(() => import('./pages/ContactPage').then((mod) => ({ default: mod.ContactPage })));
const SegmentsPage = lazy(() => import('./pages/reach/SegmentsListPage').then((mod) => ({ default: mod.SegmentsListPage })));
const SegmentPage = lazy(() => import('./pages/SegmentsPage').then((mod) => ({ default: mod.SegmentPage })));
const CampaignPage = lazy(() => import('./pages/CampaignsPage').then((mod) => ({ default: mod.CampaignPage })));
const IssuePage = lazy(() => import('./pages/IssuePage').then((mod) => ({ default: mod.IssuePage })));
const ImportPage = lazy(() => import('./pages/ImportPage').then((mod) => ({ default: mod.ImportPage })));
const EventsPage = lazy(() => import('./pages/EventsPage').then((mod) => ({ default: mod.EventsPage })));
const DuplicatesPage = lazy(() => import('./pages/DuplicatesPage').then((mod) => ({ default: mod.DuplicatesPage })));
/** Pages for contacts (unsubscribe, preferences, privacy): no staff shell, no staff session. */
const PublicApp = lazy(() => import('./public/PublicApp').then((mod) => ({ default: mod.PublicApp })));
const NewContactPage = lazy(() => import('./pages/ContactPage').then((mod) => ({ default: mod.NewContactPage })));

/** Route pages of the restructure (RESTRUCTURE R1): former Analytics tabs and new destinations. */
const Sections = () => import('./pages/SectionPages');
const CampaignDetailPage = lazy(() => Sections().then((mod) => ({ default: mod.CampaignDetailPage })));
/** MEASURE pages rebuilt in RESTRUCTURE R3. */
const CohortsPage = lazy(() => import('./pages/measure/CohortsPage').then((mod) => ({ default: mod.CohortsPage })));
const CostsPage = lazy(() => import('./pages/measure/CostsPage').then((mod) => ({ default: mod.CostsPage })));
const CampaignsLinksPage = lazy(() => import('./pages/measure/CampaignsLinksPage').then((mod) => ({ default: mod.CampaignsLinksPage })));
const DataHealthPage = lazy(() => import('./pages/measure/DataHealthPage').then((mod) => ({ default: mod.DataHealthPage })));
const AudienceHealthPage = lazy(() => import('./pages/reach/AudienceHealthPage').then((mod) => ({ default: mod.AudienceHealthPage })));
const ChannelPage = lazy(() => Sections().then((mod) => ({ default: mod.ChannelPage })));
const PeoplePage = lazy(() => Sections().then((mod) => ({ default: mod.PeoplePage })));
/** SEND and SETTINGS pages rebuilt in RESTRUCTURE R5. */
const NewsletterPage = lazy(() => import('./pages/send/NewsletterPage').then((mod) => ({ default: mod.NewsletterPage })));
const CampaignEmailsPage = lazy(() => import('./pages/send/CampaignEmailsPage').then((mod) => ({ default: mod.CampaignEmailsPage })));
const DevInboxPage = lazy(() => import('./pages/send/DevInboxPage').then((mod) => ({ default: mod.DevInboxPage })));
const EmailSettingsPage = lazy(() => import('./pages/settings/EmailSettingsPage').then((mod) => ({ default: mod.EmailSettingsPage })));
const AlertsPage = lazy(() => import('./pages/settings/AlertsPage').then((mod) => ({ default: mod.AlertsPage })));
const AdminPage = lazy(() => import('./pages/settings/AdminPage').then((mod) => ({ default: mod.AdminPage })));

const segment = (path: string, pattern: RegExp) => {
  const match = path.match(pattern)?.[1];
  return match === undefined ? undefined : decodeURIComponent(match);
};

/** The page for a path, or null for an unknown path (shown as the Overview). */
function pageFor(path: string) {
  const contactId = segment(path, /^\/contacts\/([^/]+)$/);
  const segmentId = segment(path, /^\/segments\/([^/]+)$/);
  const campaignId = segment(path, /^\/campaign-emails\/([^/]+)$/);
  const issueId = segment(path, /^\/newsletter\/([^/]+)$/);
  const campaignKey = segment(path, /^\/campaigns-links\/([^/]+)$/);
  const channel = segment(path, /^\/channels\/([^/]+)$/);
  const people = path.match(/^\/people\/([a-z]+)\/([^/]+)(?:\/([^/]+))?$/);
  switch (path) {
    case '/':
      return <HomePage />;
    case '/cohorts':
      return <CohortsPage />;
    case '/costs':
      return <CostsPage />;
    case '/campaigns-links':
      return <CampaignsLinksPage />;
    case '/data-health':
      return <DataHealthPage />;
    case '/contacts':
      return <ContactsPage />;
    case '/contacts/new':
      return <NewContactPage />;
    case '/contacts/import':
      return <ImportPage />;
    case '/contacts/duplicates':
      return <DuplicatesPage />;
    case '/segments':
      return <SegmentsPage />;
    case '/audience-health':
      return <AudienceHealthPage />;
    case '/events':
      return <EventsPage />;
    case '/newsletter':
      return <NewsletterPage />;
    case '/campaign-emails':
      return <CampaignEmailsPage />;
    case '/email-settings':
      return <EmailSettingsPage />;
    case '/alerts':
      return <AlertsPage />;
    case '/admin':
      return <AdminPage />;
    case '/design-system':
      return <DesignSystemPage />;
    case '/dev-inbox':
      return SHOW_DEV_TOOLS ? <DevInboxPage /> : null;
  }
  if (contactId !== undefined) return <ContactPage key={contactId} id={contactId} />;
  if (segmentId !== undefined) return <SegmentPage key={segmentId} id={segmentId === 'new' ? null : segmentId} />;
  if (campaignId !== undefined) return <CampaignPage key={campaignId} id={campaignId === 'new' ? null : campaignId} />;
  if (issueId !== undefined) return <IssuePage key={issueId} id={issueId} />;
  if (campaignKey !== undefined) return <CampaignDetailPage key={campaignKey} campaign={campaignKey} />;
  if (channel !== undefined) return <ChannelPage key={channel} channel={channel} />;
  if (people) return <PeoplePage stage={people[1] as Stage} channel={decodeURIComponent(people[2] as string)} campaign={people[3] ? decodeURIComponent(people[3]) : undefined} />;
  return null;
}

/** Staff shell. Layout and styling follow design-system/marketing-hub/MASTER.md. */
export function App() {
  const path = useHashRoute();
  const redirect = redirectFor(path);

  // Old addresses (bookmarks, alert links, emails) move to their new page without a history entry.
  useEffect(() => {
    if (redirect) window.location.replace(`#${redirect}`);
  }, [redirect]);

  if (path.startsWith('/p/')) {
    return (
      <Suspense fallback={<SkeletonCard />}>
        <PublicApp path={path} />
      </Suspense>
    );
  }
  if (redirect) return null;

  const found = pageFor(path);
  const current = found ? path : '/';
  return (
    <AppShell currentPath={current}>
      {/* Page change: short crossfade; the old page leaves faster than the new one arrives. */}
      <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo({ top: 0 })}>
        <m.div key={current} {...pageTransition}>
          <PageErrorBoundary>
            <Suspense fallback={<SkeletonCard />}>{found ?? <HomePage />}</Suspense>
          </PageErrorBoundary>
        </m.div>
      </AnimatePresence>
    </AppShell>
  );
}
