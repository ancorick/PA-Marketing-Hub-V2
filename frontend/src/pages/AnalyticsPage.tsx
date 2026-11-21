import { lazy, Suspense } from 'react';
import type { Stage } from '../lib/api';
import { PageHeader, SkeletonCard } from '../ui';

const ChannelSection = lazy(() => import('./analytics/ChannelSection').then((mod) => ({ default: mod.ChannelSection })));
const CampaignsSection = lazy(() => import('./analytics/CampaignsSection').then((mod) => ({ default: mod.CampaignsSection })));
const CampaignSection = lazy(() => import('./analytics/CampaignsSection').then((mod) => ({ default: mod.CampaignSection })));
const CohortsSection = lazy(() => import('./analytics/CohortsSection').then((mod) => ({ default: mod.CohortsSection })));
const MetricsSection = lazy(() => import('./analytics/MetricsSection').then((mod) => ({ default: mod.MetricsSection })));
const HealthSection = lazy(() => import('./analytics/HealthSection').then((mod) => ({ default: mod.HealthSection })));
const CostsSection = lazy(() => import('./analytics/CostsSection').then((mod) => ({ default: mod.CostsSection })));
const LinksSection = lazy(() => import('./analytics/LinksSection').then((mod) => ({ default: mod.LinksSection })));
const PeopleSection = lazy(() => import('./analytics/PeopleSection').then((mod) => ({ default: mod.PeopleSection })));
const TaxonomySection = lazy(() => import('./analytics/TaxonomySection').then((mod) => ({ default: mod.TaxonomySection })));

/** Analytics sections (PRD 9.6); each has its own hash route under #/analytics. */
export const ANALYTICS_SECTIONS = [
  { path: '/analytics/campaigns', label: 'Campaigns' },
  { path: '/analytics/cohorts', label: 'Cohorts' },
  { path: '/analytics/costs', label: 'Costs' },
  { path: '/analytics/links', label: 'Link builder' },
  { path: '/analytics/taxonomy', label: 'Channel taxonomy' },
  { path: '/analytics/health', label: 'Data health' },
  { path: '/analytics/metrics', label: 'Success metrics' },
] as const;

export function AnalyticsPage({ path }: { path: string }) {
  const people = path.match(/^\/analytics\/people\/([a-z]+)\/([^/]+)(?:\/([^/]+))?$/);
  const channel = path.match(/^\/analytics\/channels\/([^/]+)$/)?.[1];
  const campaign = path.match(/^\/analytics\/campaigns\/([^/]+)$/)?.[1];
  const current =
    ANALYTICS_SECTIONS.find((section) => section.path === path) ?? (campaign ? ANALYTICS_SECTIONS[0] : channel ? null : ANALYTICS_SECTIONS[0]);
  return (
    <>
      <PageHeader title="Analytics" description="Channels, campaigns, cohorts and costs, measured by who enrolls and gets hired." />
      <nav className="segmented subnav" aria-label="Analytics sections">
        {ANALYTICS_SECTIONS.map((section) => (
          <a key={section.path} className="segmented__btn" href={`#${section.path}`} aria-current={!people && section.path === current?.path ? 'page' : undefined}>
            {section.label}
          </a>
        ))}
      </nav>
      <Suspense fallback={<SkeletonCard />}>
        {channel ? (
          <ChannelSection key={channel} channel={decodeURIComponent(channel)} />
        ) : campaign ? (
          <CampaignSection key={campaign} campaign={decodeURIComponent(campaign)} />
        ) : people ? (
          <PeopleSection stage={people[1] as Stage} channel={decodeURIComponent(people[2] as string)} campaign={people[3] ? decodeURIComponent(people[3]) : undefined} />
        ) : (
          <>
            {current?.path === '/analytics/campaigns' && <CampaignsSection />}
            {current?.path === '/analytics/cohorts' && <CohortsSection />}
            {current?.path === '/analytics/costs' && <CostsSection />}
            {current?.path === '/analytics/links' && <LinksSection />}
            {current?.path === '/analytics/taxonomy' && <TaxonomySection />}
            {current?.path === '/analytics/health' && <HealthSection />}
            {current?.path === '/analytics/metrics' && <MetricsSection />}
          </>
        )}
      </Suspense>
    </>
  );
}
