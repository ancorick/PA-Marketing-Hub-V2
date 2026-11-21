import { lazy, Suspense } from 'react';
import { PageHeader, SkeletonCard } from '../ui';

const CostsSection = lazy(() => import('./analytics/CostsSection').then((mod) => ({ default: mod.CostsSection })));
const LinksSection = lazy(() => import('./analytics/LinksSection').then((mod) => ({ default: mod.LinksSection })));
const TaxonomySection = lazy(() => import('./analytics/TaxonomySection').then((mod) => ({ default: mod.TaxonomySection })));

/** Analytics sections (PRD 9.6); each has its own hash route under #/analytics. */
export const ANALYTICS_SECTIONS = [
  { path: '/analytics/costs', label: 'Costs' },
  { path: '/analytics/links', label: 'Link builder' },
  { path: '/analytics/taxonomy', label: 'Channel taxonomy' },
] as const;

export function AnalyticsPage({ path }: { path: string }) {
  const current = ANALYTICS_SECTIONS.find((section) => section.path === path) ?? ANALYTICS_SECTIONS[0];
  return (
    <>
      <PageHeader title="Analytics" description="Channels, campaigns, cohorts and costs, measured by who enrolls and gets hired." />
      <nav className="segmented subnav" aria-label="Analytics sections">
        {ANALYTICS_SECTIONS.map((section) => (
          <a key={section.path} className="segmented__btn" href={`#${section.path}`} aria-current={section.path === current.path ? 'page' : undefined}>
            {section.label}
          </a>
        ))}
      </nav>
      <Suspense fallback={<SkeletonCard />}>
        {current.path === '/analytics/costs' && <CostsSection />}
        {current.path === '/analytics/links' && <LinksSection />}
        {current.path === '/analytics/taxonomy' && <TaxonomySection />}
      </Suspense>
    </>
  );
}
