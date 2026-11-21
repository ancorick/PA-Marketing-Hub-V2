import { useQuery } from '@tanstack/react-query';
import { contactAttribution, MODEL_LABEL, type AttributionModel, type Channel } from '../lib/api';
import { formatDate, formatPercent } from '../lib/format';

const SPECIAL: Record<string, string> = { unmapped: 'Unmapped', unattributed: 'No recorded touch' };

/** How this person's outcomes are credited under each model (PRD 9.4, ANL-06, ANL-07). */
export function ContactAttribution({ contactId, channels, version }: { contactId: string; channels: Channel[]; version: string }) {
  const result = useQuery({ queryKey: ['contact-attribution', contactId, version], queryFn: () => contactAttribution(contactId) });
  if (!result.isSuccess) return null;
  const name = (id: string) => SPECIAL[id] ?? channels.find((channel) => channel.id === id)?.name ?? id;
  return (
    <section className="card stack" aria-labelledby="attribution-heading">
      <h2 id="attribution-heading">Attribution</h2>
      <p className="muted">
        {result.data.anchor ? `Touches in the 365 days before the application on ${formatDate(result.data.anchor)}.` : 'Touches in the last 365 days; no application yet.'} Estimated
        opens do not count.
      </p>
      <dl className="facts">
        {(Object.keys(MODEL_LABEL) as AttributionModel[]).map((model) => (
          <div key={model}>
            <dt>{MODEL_LABEL[model]}</dt>
            <dd>
              {result.data.models[model]
                .map((credit) => `${name(credit.channel)}${credit.campaign ? ` (${credit.campaign})` : ''}${credit.share < 1 ? ` ${formatPercent(credit.share, undefined, { maximumFractionDigits: 0 })}` : ''}`)
                .join(', ')}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
