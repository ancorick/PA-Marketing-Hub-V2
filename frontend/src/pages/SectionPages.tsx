import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode } from 'react';
import { listAlerts, type Stage } from '../lib/api';
import { useStaffRole } from '../lib/session';
import { EmptyState, PageHeader, SkeletonCard } from '../ui';
import { AlertsPanel } from './AlertsPanel';

/*
 * RESTRUCTURE R1: the tabs of the former Analytics page are pages of their own in the left navigation. R3 rebuilt
 * Cohorts, Costs, Campaigns & links and Data health in pages/measure; the detail pages below keep their sections.
 */
const CampaignSection = lazy(() => import('./analytics/CampaignsSection').then((mod) => ({ default: mod.CampaignSection })));
const MetricsSection = lazy(() => import('./analytics/MetricsSection').then((mod) => ({ default: mod.MetricsSection })));
const ChannelSection = lazy(() => import('./analytics/ChannelSection').then((mod) => ({ default: mod.ChannelSection })));
const PeopleSection = lazy(() => import('./analytics/PeopleSection').then((mod) => ({ default: mod.PeopleSection })));

function SectionPage({ title, accent, description, children }: { title: string; accent?: string; description: string; children: ReactNode }) {
  return (
    <>
      <PageHeader title={title} accent={accent} description={description} />
      <Suspense fallback={<SkeletonCard />}>{children}</Suspense>
    </>
  );
}

export function CampaignDetailPage({ campaign }: { campaign: string }) {
  return (
    <SectionPage title="Campaign" description="Spend, credited outcomes and cost per outcome for one campaign.">
      <CampaignSection campaign={campaign} />
    </SectionPage>
  );
}

/** Until R4 builds it, Audience health shows the success metrics, which move here and to the Overview. */
export function AudienceHealthPage() {
  return (
    <SectionPage title="Audience health" description="Growth, consent coverage, duplicates and list hygiene, with the success metrics of PRD 3.2.">
      <MetricsSection />
    </SectionPage>
  );
}

export function ChannelPage({ channel }: { channel: string }) {
  return (
    <SectionPage title="Channel" description="Funnel from lead to hired, campaigns inside the channel and its 12-month trend.">
      <ChannelSection channel={channel} />
    </SectionPage>
  );
}

export function PeoplePage({ stage, channel, campaign }: { stage: Stage; channel: string; campaign?: string }) {
  return (
    <SectionPage title="People behind a number" description="The contacts credited for one number, for the marketing team only.">
      <PeopleSection stage={stage} channel={channel} campaign={campaign} />
    </SectionPage>
  );
}

/** Alerts (RESTRUCTURE §3): its own page; R5 adds levels and history. */
export function AlertsPage() {
  const role = useStaffRole();
  const alerts = useQuery({ queryKey: ['alerts', role], queryFn: listAlerts, refetchInterval: 60_000 });
  const open = alerts.data?.alerts.filter((alert) => !alert.resolvedAt) ?? [];
  return (
    <>
      <PageHeader title="Alerts" description="Paused sends, failing data sources and DMARC warnings that need a person." />
      {alerts.isPending ? (
        <SkeletonCard />
      ) : open.length === 0 ? (
        <section className="card">
          <EmptyState title="No open alerts">Guardrails, failing sources and DMARC warnings appear here and in the sidebar badge.</EmptyState>
        </section>
      ) : (
        <AlertsPanel />
      )}
    </>
  );
}
