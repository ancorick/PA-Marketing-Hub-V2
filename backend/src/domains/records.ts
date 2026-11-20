import type { EspDomainIdentity, ExpectedRecord } from './types.js';

/**
 * The exact records to publish for a sending domain (PRD 7.2, EML-02).
 * - SPF authorizes the ESP and nothing else and ends with a hard fail.
 * - DKIM comes from the ESP (one entry per selector, so keys rotate without downtime).
 * - DMARC starts at monitoring (p=none) with aggregate reports; the policy is raised later by hand.
 * - The tracking CNAME gives links a branded host (7.1).
 */
export function expectedRecords(
  domain: string,
  identity: EspDomainIdentity,
  options: { dmarcReportEmail?: string } = {},
): ExpectedRecord[] {
  const reportEmail = options.dmarcReportEmail ?? `dmarc-reports@${domain}`;
  return [
    {
      kind: 'spf',
      type: 'TXT',
      host: domain,
      value: `v=spf1 include:${identity.spfInclude} -all`,
      requiredForSending: true,
    },
    ...identity.dkim.map(
      (key): ExpectedRecord => ({
        kind: 'dkim',
        type: key.type,
        host: `${key.selector}._domainkey.${domain}`,
        value: key.value,
        requiredForSending: true,
      }),
    ),
    {
      kind: 'dmarc',
      type: 'TXT',
      host: `_dmarc.${domain}`,
      value: `v=DMARC1; p=none; rua=mailto:${reportEmail}; adkim=r; aspf=r; fo=1`,
      requiredForSending: true,
    },
    {
      kind: 'tracking',
      type: 'CNAME',
      host: `${identity.trackingLabel}.${domain}`,
      value: identity.trackingTarget,
      requiredForSending: false,
    },
  ];
}
