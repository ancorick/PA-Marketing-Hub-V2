import { ArrowClockwise, GlobeSimple, LockSimple, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  addDomain,
  ApiError,
  listDomains,
  removeDomain,
  verifyDomain,
  type CheckStatus,
  type DnsRecordKind,
  type DomainRecord,
  type SendingDomain,
} from '../lib/api';
import { formatDate } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { WarmupSection } from './WarmupSection';
import {
  Alert,
  Button,
  ConfirmDialog,
  CopyButton,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonCard,
  StatusBadge,
  Tag,
  TextField,
  type Column,
  type Tone,
} from '../ui';

const KIND_LABEL: Record<DnsRecordKind, string> = {
  spf: 'SPF',
  dkim: 'DKIM',
  dmarc: 'DMARC',
  tracking: 'Tracking link',
};

const KIND_PURPOSE: Record<DnsRecordKind, string> = {
  spf: 'Lists the servers allowed to send for this domain',
  dkim: 'Public key that proves messages were signed by the domain',
  dmarc: 'Tells receivers what to do when SPF or DKIM fail, and where to send reports',
  tracking: 'Branded host for click tracking',
};

const CHECK: Record<CheckStatus, { tone: Tone; label: string }> = {
  verified: { tone: 'success', label: 'Verified' },
  missing: { tone: 'danger', label: 'Not found' },
  invalid: { tone: 'danger', label: 'Wrong value' },
  error: { tone: 'warning', label: 'Lookup failed' },
  pending: { tone: 'neutral', label: 'Not checked' },
};

const DOMAIN_STATUS: Record<SendingDomain['status'], { tone: Tone; label: string }> = {
  verified: { tone: 'success', label: 'Verified' },
  action_needed: { tone: 'danger', label: 'Action needed' },
  pending: { tone: 'neutral', label: 'Not checked yet' },
};

const DOMAINS_KEY = ['email-domains'] as const;

const formatTime = (iso: string) => formatDate(iso, undefined, { timeStyle: 'short' });

function RecordStatus({ record }: { record: DomainRecord }) {
  const status = CHECK[record.status];
  return (
    <div className="stack stack--xs dns-status">
      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      {record.problems.length > 0 && (
        <ul className="dns-problems">
          {record.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {record.status !== 'verified' && record.found.length > 0 && (
        <p className="dns-found">
          Published now: <code>{record.found.join(' | ')}</code>
        </p>
      )}
    </div>
  );
}

function recordColumns(domain: string): Column<DomainRecord>[] {
  return [
    {
      key: 'kind',
      header: 'Record',
      render: (record) => (
        <div className="stack stack--xs">
          <span>{KIND_LABEL[record.kind]}</span>
          <span className="dns-purpose">{KIND_PURPOSE[record.kind]}</span>
          {!record.requiredForSending && <Tag>Optional for sending</Tag>}
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (record) => <code className="dns-type">{record.type}</code> },
    {
      key: 'host',
      header: 'Host',
      render: (record) => (
        <div className="dns-copy">
          <code>{record.host}</code>
          <CopyButton value={record.host} label={`Copy ${KIND_LABEL[record.kind]} host for ${domain}`} />
        </div>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      render: (record) => (
        <div className="dns-copy dns-copy--value">
          <code>{record.value}</code>
          <CopyButton value={record.value} label={`Copy ${KIND_LABEL[record.kind]} value for ${domain}`} />
        </div>
      ),
    },
    { key: 'status', header: 'Live status', render: (record) => <RecordStatus record={record} /> },
  ];
}

function DomainCard({ domain, canManage }: { domain: SendingDomain; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const headingId = `domain-${domain.id}`;

  const replace = (updated: SendingDomain) =>
    queryClient.setQueriesData<{ domains: SendingDomain[] }>({ queryKey: DOMAINS_KEY }, (current) =>
      current ? { domains: current.domains.map((item) => (item.id === updated.id ? updated : item)) } : current,
    );

  const verify = useMutation({ mutationFn: () => verifyDomain(domain.id), onSuccess: replace });
  const remove = useMutation({
    mutationFn: () => removeDomain(domain.id),
    onSuccess: () => {
      setConfirmRemove(false);
      void queryClient.invalidateQueries({ queryKey: DOMAINS_KEY });
    },
  });

  const status = DOMAIN_STATUS[domain.status];
  const required = domain.records.filter((record) => record.requiredForSending);
  const passing = required.filter((record) => record.status === 'verified').length;

  return (
    <section className="card stack" aria-labelledby={headingId}>
      <div className="card__header">
        <div className="cluster">
          <span className="icon-tile icon-tile--sm icon-tile--brand">
            <GlobeSimple size={20} weight="bold" aria-hidden />
          </span>
          <h2 id={headingId} className="domain-name">
            {domain.domain}
          </h2>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
        <div className="cluster">
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowClockwise size={16} weight="bold" aria-hidden />}
            loading={verify.isPending}
            onClick={() => verify.mutate()}
          >
            Check DNS now
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash size={16} weight="bold" aria-hidden />}
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      <div className="inset">
        <dl className="domain-facts">
          <div>
            <dt>Marketing sends</dt>
            <dd>
              <StatusBadge tone={domain.canSendMarketing ? 'success' : 'danger'}>
                {domain.canSendMarketing ? 'Allowed' : 'Blocked'}
              </StatusBadge>
              {domain.blockedReason && <span className="muted">{domain.blockedReason}</span>}
            </dd>
          </div>
          <div>
            <dt>Required records passing</dt>
            <dd className="num">
              {passing} of {required.length}
            </dd>
          </div>
          <div>
            <dt>DMARC policy</dt>
            <dd>{domain.dmarcPolicy ? <code>p={domain.dmarcPolicy}</code> : <span className="muted">Not published</span>}</dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd>{domain.lastCheckedAt ? formatTime(domain.lastCheckedAt) : <span className="muted">Never</span>}</dd>
          </div>
        </dl>
      </div>

      {domain.esp.placeholder && (
        <Alert tone="warning" title="Placeholder values: do not publish these records yet">
          No email service is chosen yet (PRD 16.3, question 1), so the SPF include, DKIM and tracking targets are
          stand-ins under the reserved .invalid domain. They are replaced when the email service is connected.
        </Alert>
      )}

      <div role="status" aria-live="polite" className="stack stack--sm">
        {verify.isError && (
          <Alert tone="danger" title="DNS check failed">
            {verify.error.message}. Try again in a minute.
          </Alert>
        )}
        {verify.isSuccess && (
          <span className="visually-hidden">
            DNS checked: {passing} of {required.length} required records pass. Marketing sends are{' '}
            {domain.canSendMarketing ? 'allowed' : 'blocked'}.
          </span>
        )}
      </div>

      <DataTable
        caption={`DNS records to add at the DNS host of ${domain.domain}`}
        columns={recordColumns(domain.domain)}
        rows={domain.records}
        rowKey={(record) => `${record.kind}:${record.host}`}
      />
      <p className="muted dns-note">
        Add each record at the Academy's DNS host, then press "Check DNS now". DNS changes can take up to an hour to
        appear. Raise DMARC from <code>p=none</code> to quarantine after two clean weeks of reports (PRD 7.2).
      </p>

      <WarmupSection domain={domain} canManage={canManage} onUpdated={replace} />

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${domain.domain}?`}
        confirmLabel="Remove domain"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmRemove(false)}
      >
        <p>
          Marketing Hub stops sending from {domain.domain} and forgets its DNS check results. The records at your DNS
          host stay as they are; remove them there if the domain is no longer used.
          {/* When campaigns exist (phase 1), show the number of scheduled sends from this domain here. */}
        </p>
        {remove.isError && (
          <Alert tone="danger" title="Could not remove the domain">
            {remove.error.message}
          </Alert>
        )}
      </ConfirmDialog>
    </section>
  );
}

function AddDomainForm() {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const add = useMutation({
    mutationFn: addDomain,
    onSuccess: (created) => {
      setValue('');
      queryClient.setQueriesData<{ domains: SendingDomain[] }>({ queryKey: DOMAINS_KEY }, (current) =>
        current ? { domains: [...current.domains, created] } : current,
      );
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate(value);
  };

  const fieldError =
    add.error instanceof ApiError && ['invalid_domain', 'domain_exists', 'invalid_request'].includes(add.error.code ?? '')
      ? add.error.message
      : undefined;

  return (
    <section className="card" aria-labelledby="add-domain-heading">
      <form className="stack" onSubmit={submit} noValidate>
        <div className="card__header">
          <h2 id="add-domain-heading">Add a sending domain</h2>
        </div>
        <div className="add-domain">
          <TextField
            label="Sending subdomain"
            name="domain"
            required
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            placeholder="news.academy-domain.am"
            hint="Use a dedicated subdomain, not the main domain, so staff mailboxes keep their reputation (PRD 7.1)."
            value={value}
            error={fieldError}
            onChange={(event) => {
              setValue(event.target.value);
              if (add.isError) add.reset();
            }}
          />
          <Button type="submit" variant="primary" loading={add.isPending} disabled={value.trim() === ''}>
            Add domain
          </Button>
        </div>
        <div role="status" aria-live="polite">
          {add.isSuccess && (
            <Alert tone="success" title={`${add.data.domain} added`}>
              Publish the records below at the DNS host, then press "Check DNS now".
            </Alert>
          )}
          {add.isError && !fieldError && (
            <Alert tone="danger" title="Could not add the domain">
              {add.error.message}
            </Alert>
          )}
        </div>
      </form>
    </section>
  );
}

/**
 * Email settings (PRD 13.6): sending domains with the exact DNS records and their live status (EML-02),
 * whether marketing email may leave from each domain (EML-03) and its warm-up plan (EML-08).
 * The kill switch (EML-14) joins this screen later. Admins manage domains; marketing managers view and re-check.
 */
export function EmailSettingsPage() {
  const role = useStaffRole();
  const canManage = role === 'admin';
  // The role is part of the key: switching the mock role refetches with the new token.
  const domains = useQuery({
    queryKey: [...DOMAINS_KEY, role],
    queryFn: listDomains,
    // A 4xx answer (no session, wrong role) will not change on retry.
    retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 1,
  });
  const data = domains.data;

  const unauthorized = domains.error instanceof ApiError && domains.error.status === 401;
  const forbidden = unauthorized || (domains.error instanceof ApiError && domains.error.status === 403);

  return (
    <>
      <PageHeader
        title="Email"
        accent="settings"
        description="Sending domains and their DNS records, checked live against public DNS."
      />
      {forbidden ? (
        <section className="card">
          {unauthorized ? (
            <EmptyState title="Sign-in is not available yet" icon={<LockSimple size={28} weight="bold" aria-hidden />}>
              Staff sign-in arrives with the Core Engine. Until then this API only accepts mock roles where
              ALLOW_MOCK_SIGN_IN is on (local development).
            </EmptyState>
          ) : (
            <EmptyState title="Email settings are for admins and marketing managers" icon={<LockSimple size={28} weight="bold" aria-hidden />}>
              Your role cannot view sending domains. Ask an admin if you need access.
            </EmptyState>
          )}
        </section>
      ) : (
        <div className="stack stack--lg">
          {canManage && <AddDomainForm />}
          {domains.isPending && <SkeletonCard />}
          {domains.isError && !forbidden && (
            <Alert
              tone="danger"
              title="Sending domains could not be loaded"
              action={
                <Button size="sm" variant="secondary" onClick={() => void domains.refetch()}>
                  Try again
                </Button>
              }
            >
              {domains.error.message}. Check that the backend is running.
            </Alert>
          )}
          {data && data.domains.length === 0 && (
            <section className="card">
              <EmptyState title="No sending domain yet" icon={<GlobeSimple size={28} weight="bold" aria-hidden />}>
                {canManage
                  ? 'Add the Academy’s sending subdomain above to get the exact DNS records to publish.'
                  : 'An admin adds the Academy’s sending subdomain here. Until then, marketing email cannot be sent.'}
              </EmptyState>
            </section>
          )}
          {data?.domains.map((domain) => <DomainCard key={domain.id} domain={domain} canManage={canManage} />)}
        </div>
      )}
    </>
  );
}
