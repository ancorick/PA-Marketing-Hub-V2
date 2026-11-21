import { ArrowLeft } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { getCampaignDetail, listAnalyticsChannels, listCampaignResults, type Count } from '../../lib/api';
import { formatAmd, formatNumber } from '../../lib/format';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, DataTable, SectionTitle, SkeletonCard, StatTile } from '../../ui';
import { campaignColumns } from './campaignColumns';
import { channelLabel, countText } from './numbers';
import { ModelSwitch, PeriodPicker, useModel, usePeriod } from './period';

const tile = (value: Count) => (value === 'fewer_than_3' ? null : countText(value));
const money = (value: number | null) => (value === null ? '—' : formatAmd(value));

/** All campaigns with results or cost in the period (ANL-09). */
export function CampaignsSection() {
  const role = useStaffRole();
  const [period, setPeriod] = usePeriod();
  const [model, setModel] = useModel();
  const list = useQuery({ queryKey: ['campaign-results', role, period, model], queryFn: () => listCampaignResults(period, model) });
  const access = accessProblem(list.error);
  if (access)
    return (
      <AccessNotice problem={access} title="Sign in to see campaign results">
        Every staff role sees campaign results.
      </AccessNotice>
    );
  return (
    <div className="stack stack--lg">
      <div className="cluster">
        <ModelSwitch model={model} onChange={setModel} />
      </div>
      <PeriodPicker period={period} onChange={setPeriod} />
      {list.isError && <Alert tone="danger" title="Campaigns not loaded">{list.error.message}</Alert>}
      <section className="card stack" aria-labelledby="campaigns-heading">
        <h2 id="campaigns-heading">Campaigns</h2>
        <p className="muted">Outcomes credited to each campaign by {list.data?.modelLabel.toLowerCase() ?? 'the chosen model'}; cost in AMD. Open a campaign for its spend and cost per outcome.</p>
        <DataTable
          caption="Campaigns"
          captionHidden
          columns={campaignColumns({ modelNote: list.data ? ` Attribution: ${list.data.modelLabel}.` : '', marketing: false })}
          rows={list.data?.campaigns ?? []}
          rowKey={(row) => row.campaign}
          loading={list.isPending}
          initialSort={{ key: 'cost', direction: 'descending' }}
          exportFile={`campaigns-${period.from}-${period.to}-${model}`}
          empty="No campaign results or spend in this period. Tag links with the Link builder so visits carry a campaign."
        />
      </section>
    </div>
  );
}

/** Campaign detail (PRD 9.6): spend, leads, applications, enrolled and cost per outcome for one campaign. */
export function CampaignSection({ campaign }: { campaign: string }) {
  const role = useStaffRole();
  const [period, setPeriod] = usePeriod();
  const [model, setModel] = useModel();
  const detail = useQuery({ queryKey: ['campaign-detail', role, campaign, period, model], queryFn: () => getCampaignDetail(campaign, period, model) });
  const channels = useQuery({ queryKey: ['analytics-channels', role], queryFn: listAnalyticsChannels, staleTime: Infinity });
  const data = detail.data;
  const modelNote = data ? ` Attribution: ${data.modelLabel}.` : '';
  return (
    <div className="stack stack--lg">
      <div className="cluster spread">
        <a className="cluster" href="#/campaigns-links">
          <ArrowLeft size={16} aria-hidden /> All campaigns
        </a>
        <ModelSwitch model={model} onChange={setModel} />
      </div>
      <SectionTitle title={campaign} />
      <PeriodPicker period={period} onChange={setPeriod} />
      {detail.isError && <Alert tone="danger" title="Campaign not loaded">{detail.error.message}</Alert>}
      {detail.isPending && <SkeletonCard />}
      {data && (
        <>
          <div className="tiles">
            <StatTile tone="yellow" label="Cost" value={formatAmd(data.costAmd)} definition="Ad spend for the campaign plus manual costs that name it, in the period, in AMD." />
            <StatTile label="Leads" value={tile(data.lead)} definition={`Leads credited to the campaign.${modelNote}`} />
            <StatTile label="Applicants" value={tile(data.applied)} definition={`Applicants credited to the campaign.${modelNote}`} />
            <StatTile label="Enrolled" value={tile(data.enrolled)} definition={`Enrolled students credited to the campaign.${modelNote}`} />
          </div>
          <section className="card stack" aria-labelledby="campaign-cost-heading">
            <h3 id="campaign-cost-heading">Cost per outcome</h3>
            <dl className="facts">
              <div>
                <dt>Per lead</dt>
                <dd className="num">{money(data.costPerLead)}</dd>
              </div>
              <div>
                <dt>Per applicant</dt>
                <dd className="num">{money(data.costPerApplicant)}</dd>
              </div>
              <div>
                <dt>Per enrolled student</dt>
                <dd className="num">{money(data.costPerEnrolled)}</dd>
              </div>
            </dl>
          </section>
          <section className="card stack" aria-labelledby="campaign-platform-heading">
            <h3 id="campaign-platform-heading">Reported by the ad platforms</h3>
            <p className="muted">Platform numbers count clicks and form fills, not people; they are not attribution.</p>
            <dl className="facts">
              <div>
                <dt>Ad spend</dt>
                <dd className="num">{formatAmd(data.adSpendAmd)}</dd>
              </div>
              <div>
                <dt>Impressions</dt>
                <dd className="num">{formatNumber(data.impressions)}</dd>
              </div>
              <div>
                <dt>Clicks</dt>
                <dd className="num">{formatNumber(data.clicks)}</dd>
              </div>
              <div>
                <dt>Platform leads</dt>
                <dd className="num">{formatNumber(data.platformLeads)}</dd>
              </div>
              <div>
                <dt>Channels</dt>
                <dd>{data.channels.length ? data.channels.map((id) => channelLabel(id, channels.data?.channels)).join(', ') : '—'}</dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
