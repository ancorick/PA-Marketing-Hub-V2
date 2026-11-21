import type { CampaignRow } from '../../lib/api';
import { formatAmd } from '../../lib/format';
import type { Column } from '../../ui';
import { CountCell, countCsv, countValue, peoplePath } from './numbers';

const money = (value: number | null) => (value === null ? <span className="muted">—</span> : formatAmd(value));

/** Campaign table columns shared by the channel detail and the campaigns list. */
export function campaignColumns(definitions: { modelNote: string; marketing: boolean; channel?: string }): Column<CampaignRow>[] {
  const people = (stage: 'lead' | 'applied' | 'enrolled', row: CampaignRow) => (definitions.marketing && definitions.channel ? peoplePath(stage, definitions.channel, row.campaign) : null);
  return [
    {
      key: 'campaign',
      header: 'Campaign',
      render: (row) => (row.campaign === '(no campaign)' ? <span className="muted">No campaign</span> : <a href={`#/campaigns-links/${encodeURIComponent(row.campaign)}`}>{row.campaign}</a>),
      sortValue: (row) => row.campaign,
    },
    ...(['lead', 'applied', 'enrolled'] as const).map(
      (stage): Column<CampaignRow> => ({
        key: stage,
        header: { lead: 'Leads', applied: 'Applicants', enrolled: 'Enrolled' }[stage],
        numeric: true,
        definition: `Credited to the campaign.${definitions.modelNote}`,
        render: (row) => <CountCell value={row[stage]} href={people(stage, row)} label={stage} />,
        csv: (row) => countCsv(row[stage]),
        sortValue: (row) => countValue(row[stage]),
      }),
    ),
    { key: 'cost', header: 'Cost', numeric: true, definition: 'Ad spend for the campaign plus manual costs that name it, in the period.', render: (row) => formatAmd(row.costAmd), sortValue: (row) => row.costAmd },
    { key: 'perEnrolled', header: 'Cost per enrolled', numeric: true, render: (row) => money(row.costPerEnrolled), sortValue: (row) => row.costPerEnrolled ?? -1, csv: (row) => row.costPerEnrolled },
  ];
}

export { money };
