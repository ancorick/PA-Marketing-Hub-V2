export type { EspDomainIdentity } from '../email/adapter.js';

/** The four DNS mechanisms of a sending domain (PRD 7.1, 7.2). */
export type DnsRecordKind = 'spf' | 'dkim' | 'dmarc' | 'tracking';
export type DnsRecordType = 'TXT' | 'CNAME';

/** pending = never checked; missing = no record; invalid = record is wrong; error = DNS lookup failed. */
export type CheckStatus = 'pending' | 'verified' | 'missing' | 'invalid' | 'error';

export type DmarcPolicy = 'none' | 'quarantine' | 'reject';

/** A record the administrator has to add at the DNS host (EML-02). */
export type ExpectedRecord = {
  kind: DnsRecordKind;
  type: DnsRecordType;
  /** Fully qualified host name. */
  host: string;
  value: string;
  /** SPF, DKIM and DMARC gate marketing sends (EML-03); the tracking CNAME does not. */
  requiredForSending: boolean;
};

export type RecordCheck = {
  kind: DnsRecordKind;
  host: string;
  status: Exclude<CheckStatus, 'pending'>;
  /** Values currently published at the host, as receivers see them. */
  found: string[];
  /** Plain-language reasons the record does not pass; empty when verified. */
  problems: string[];
};

export type DnsCheckResult = {
  checkedAt: string;
  records: RecordCheck[];
  dmarcPolicy: DmarcPolicy | null;
};
