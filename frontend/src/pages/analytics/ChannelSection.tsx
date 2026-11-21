import { ArrowLeft } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
  getChannelDetail,
  listAnalyticsChannels,
  type Count,
  type Stage,
} from "../../lib/api";
import { formatAmd, formatNumber, formatPercent } from "../../lib/format";
import { useStaffRole } from "../../lib/session";
import { BarChart } from "../../motion";
import {
  AccessNotice,
  accessProblem,
  Alert,
  DataTable,
  SectionTitle,
  SkeletonCard,
  StatTile,
} from "../../ui";
import { campaignColumns } from "./campaignColumns";
import { channelLabel, countText, STAGE_LABEL } from "./numbers";
import { ModelSwitch, PeriodPicker, useModel, usePeriod } from "./period";

const MARKETING = ["editor", "marketing_manager", "admin"];
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString("en", {
    month: "short",
    timeZone: "UTC",
  });
const tile = (value: Count) =>
  value === "fewer_than_3" ? null : countText(value);

/** Channel detail (PRD 9.6, ANL-09): funnel from lead to hired, campaigns inside it, 12-month trend. */
export function ChannelSection({ channel }: { channel: string }) {
  const role = useStaffRole();
  const [period, setPeriod] = usePeriod();
  const [model, setModel] = useModel();
  const detail = useQuery({
    queryKey: ["channel-detail", role, channel, period, model],
    queryFn: () => getChannelDetail(channel, period, model),
  });
  const channels = useQuery({
    queryKey: ["analytics-channels", role],
    queryFn: listAnalyticsChannels,
    staleTime: Infinity,
  });
  const name = channelLabel(channel, channels.data?.channels);
  const access = accessProblem(detail.error);
  if (access)
    return (
      <AccessNotice problem={access} title="Sign in to see channel results">
        Every staff role sees channel results.
      </AccessNotice>
    );
  const data = detail.data;
  const modelNote = data ? ` Attribution: ${data.modelLabel}.` : "";
  const trendChartable = data?.trend.every(
    (month) =>
      typeof month.lead === "number" && typeof month.enrolled === "number",
  );
  const conversion = (from: Stage, to: Stage) => {
    if (!data) return undefined;
    const a = data.funnel[from];
    const b = data.funnel[to];
    return typeof a === "number" && typeof b === "number" && a > 0
      ? formatPercent(b / a, undefined, { maximumFractionDigits: 0 })
      : undefined;
  };

  return (
    <div className="stack stack--lg">
      <div className="cluster spread">
        <a className="cluster" href="#/">
          <ArrowLeft size={16} aria-hidden /> Overview
        </a>
        <ModelSwitch model={model} onChange={setModel} />
      </div>
      <SectionTitle title={name} />
      <PeriodPicker period={period} onChange={setPeriod} />
      {detail.isError && (
        <Alert tone="danger" title="Channel not loaded">
          {detail.error.message}
        </Alert>
      )}
      {detail.isPending && <SkeletonCard />}
      {data && (
        <>
          <div className="tiles">
            {(
              ["lead", "applied", "enrolled", "completed", "hired"] as const
            ).map((stage, index, all) => (
              <StatTile
                key={stage}
                tone={stage === "enrolled" ? "yellow" : undefined}
                label={STAGE_LABEL[stage]}
                value={tile(data.funnel[stage])}
                definition={`${index === 0 ? "Leads credited to this channel in the period." : `${conversion(all[index - 1] as Stage, stage) ?? "n/a"} of the previous step.`}${modelNote}`}
              />
            ))}
          </div>
          <section
            className="card stack"
            aria-labelledby="channel-cost-heading"
          >
            <h3 id="channel-cost-heading">Cost</h3>
            <dl className="facts">
              <div>
                <dt>Channel cost</dt>
                <dd className="num">{formatAmd(data.costAmd)}</dd>
              </div>
              <div>
                <dt>Cost per lead</dt>
                <dd className="num">
                  {data.costPerLead === null
                    ? "—"
                    : formatAmd(data.costPerLead)}
                </dd>
              </div>
              <div>
                <dt>Cost per enrolled student</dt>
                <dd className="num">
                  {data.costPerEnrolled === null
                    ? "—"
                    : formatAmd(data.costPerEnrolled)}
                </dd>
              </div>
            </dl>
          </section>
          <section
            className="card stack"
            aria-labelledby="channel-campaigns-heading"
          >
            <h3 id="channel-campaigns-heading">Campaigns</h3>
            <DataTable
              caption={`Campaigns in ${name}`}
              captionHidden
              columns={campaignColumns({
                modelNote,
                marketing: MARKETING.includes(role),
                channel,
              })}
              rows={data.campaigns}
              rowKey={(row) => row.campaign}
              initialSort={{ key: "lead", direction: "descending" }}
              empty="No campaign results or spend in this period."
              exportFile={`${channel}-campaigns-${period.from}-${period.to}-${model}`}
            />
          </section>
          <section
            className="card stack"
            aria-labelledby="channel-trend-heading"
          >
            <h3 id="channel-trend-heading">Last 12 months</h3>
            {trendChartable ? (
              <div className="chart-narrow">
                <BarChart
                  data={data.trend.map((month) => ({
                    label: monthLabel(month.month),
                    value: month.enrolled as number,
                  }))}
                  unit="Enrolled"
                  summary={`Enrolled students credited to ${name} per month, ${data.trend[0]?.month} to ${data.trend.at(-1)?.month}: ${formatNumber(
                    data.trend.reduce(
                      (sum, month) => sum + (month.enrolled as number),
                      0,
                    ),
                    undefined,
                    { maximumFractionDigits: 1 },
                  )} in total (${data.modelLabel}).`}
                />
              </div>
            ) : (
              <ul className="list-reset stack stack--sm">
                {data.trend.map((month) => (
                  <li key={month.month} className="cluster spread">
                    <span>{month.month}</span>
                    <span className="num">
                      {countText(month.lead)} leads ·{" "}
                      {countText(month.enrolled)} enrolled
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
