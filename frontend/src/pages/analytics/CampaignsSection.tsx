import { ArrowLeft } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { getCampaignDetail, listAnalyticsChannels, type Count } from '../../lib/api';
import { formatAmd, formatNumber } from '../../lib/format';
import { useStaffRole } from '../../lib/session';
import { Alert, SectionTitle, SkeletonCard, StatTile } from '../../ui';
import { channelLabel, countText } from './numbers';
import { ModelSwitch, PeriodPicker, useModel, usePeriod } from './period';

const tile = (value: Count) => (value === 'fewer_than_3' ? null : countText(value));
const money = (value: number | null) => (value === null ? '—' : formatAmd(value));

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
