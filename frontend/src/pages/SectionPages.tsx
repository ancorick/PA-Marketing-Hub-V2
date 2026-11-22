import { lazy, Suspense, type ReactNode } from 'react';
import type { Stage } from '../lib/api';
import { PageHeader, SkeletonCard } from '../ui';

/*
 * RESTRUCTURE R1: the tabs of the former Analytics page are pages of their own in the left navigation. R3 rebuilt
 * Cohorts, Costs, Campaigns & links and Data health in pages/measure; the detail pages below keep their sections.
 */
const CampaignSection = lazy(() => import('./analytics/CampaignsSection').then((mod) => ({ default: mod.CampaignSection })));
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
