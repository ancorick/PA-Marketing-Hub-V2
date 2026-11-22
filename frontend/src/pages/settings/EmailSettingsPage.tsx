import { ArrowClockwise, GlobeSimple, ShieldCheck, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  addDomain,
  ApiError,
  dmarcSummary,
  getGuardrails,
  listDomains,
  removeDomain,
  verifyDomain,
  type CheckStatus,
  type DnsRecordKind,
  type DomainRecord,
  type SendingDomain,
} from '../../lib/api';
import { formatDate, formatNumber, formatPercent } from '../../lib/format';
import { useT, type StringKey } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import { DmarcSection } from '../DmarcSection';
import { KillSwitchBanner, KillSwitchButton, useKillSwitch } from '../KillSwitch';
import { WarmupSection } from '../WarmupSection';
import {
  AccessNotice,
  accessProblem,
  Alert,
  Button,
  ConfirmDialog,
  CopyButton,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonCard,
  SkeletonTile,
  StatTile,
  StatusBadge,
  Tag,
  TextField,
  retryServerErrors,
  type Column,
  type Tone,
} from '../../ui';

const KIND_KEY: Record<DnsRecordKind, StringKey> = { spf: 'es.kind.spf', dkim: 'es.kind.dkim', dmarc: 'es.kind.dmarc', tracking: 'es.kind.tracking' };
const PURPOSE_KEY: Record<DnsRecordKind, StringKey> = { spf: 'es.purpose.spf', dkim: 'es.purpose.dkim', dmarc: 'es.purpose.dmarc', tracking: 'es.purpose.tracking' };

const CHECK: Record<CheckStatus, { tone: Tone; key: StringKey }> = {
  verified: { tone: 'success', key: 'es.check.verified' },
  missing: { tone: 'danger', key: 'es.check.missing' },
  invalid: { tone: 'danger', key: 'es.check.invalid' },
  error: { tone: 'warning', key: 'es.check.error' },
  pending: { tone: 'neutral', key: 'es.check.pending' },
};

const DOMAIN_STATUS: Record<SendingDomain['status'], { tone: Tone; key: StringKey }> = {
  verified: { tone: 'success', key: 'es.status.verified' },
  action_needed: { tone: 'danger', key: 'es.status.action_needed' },
  pending: { tone: 'neutral', key: 'es.status.pending' },
};

const DOMAINS_KEY = ['email-domains'] as const;

const formatTime = (iso: string) => formatDate(iso, undefined, { timeStyle: 'short' });

function RecordStatus({ record }: { record: DomainRecord }) {
  const t = useT();
  const status = CHECK[record.status];
  return (
    <div className="stack stack--xs dns-status">
      <StatusBadge tone={status.tone}>{t(status.key)}</StatusBadge>
      {record.problems.length > 0 && (
        <ul className="dns-problems">
          {record.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {record.status !== 'verified' && record.found.length > 0 && (
        <p className="dns-found">
          {t('es.published')} <code>{record.found.join(' | ')}</code>
        </p>
      )}
    </div>
  );
}

function recordColumns(domain: string, t: ReturnType<typeof useT>): Column<DomainRecord>[] {
  return [
    {
      key: 'kind',
      header: t('es.record'),
      render: (record) => (
        <div className="stack stack--xs">
          <span>{t(KIND_KEY[record.kind])}</span>
          <span className="dns-purpose">{t(PURPOSE_KEY[record.kind])}</span>
          {!record.requiredForSending && <Tag>{t('es.optional')}</Tag>}
        </div>
      ),
    },
    { key: 'type', header: t('es.type'), render: (record) => <code className="dns-type">{record.type}</code> },
    {
      key: 'host',
      header: t('es.host'),
      render: (record) => (
        <div className="dns-copy">
          <code>{record.host}</code>
          <CopyButton value={record.host} label={t('lg.es.copyHost', { kind: t(KIND_KEY[record.kind]), domain })} />
        </div>
      ),
    },
    {
      key: 'value',
      header: t('es.value'),
      render: (record) => (
        <div className="dns-copy dns-copy--value">
          <code>{record.value}</code>
          <CopyButton value={record.value} label={t('lg.es.copyValue', { kind: t(KIND_KEY[record.kind]), domain })} />
        </div>
      ),
    },
    { key: 'status', header: t('es.liveStatus'), render: (record) => <RecordStatus record={record} /> },
  ];
}

function DomainCard({ domain, canManage }: { domain: SendingDomain; canManage: boolean }) {
  const t = useT();
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
          <StatusBadge tone={status.tone}>{t(status.key)}</StatusBadge>
        </div>
        <div className="cluster">
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowClockwise size={16} weight="bold" aria-hidden />}
            loading={verify.isPending}
            onClick={() => verify.mutate()}
          >
            {t('es.checkNow')}
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash size={16} weight="bold" aria-hidden />}
              onClick={() => setConfirmRemove(true)}
            >
              {t('es.remove')}
            </Button>
          )}
        </div>
      </div>

      <div className="inset">
        <dl className="domain-facts">
          <div>
            <dt>{t('es.marketingSends')}</dt>
            <dd>
              <StatusBadge tone={domain.canSendMarketing ? 'success' : 'danger'}>
                {domain.canSendMarketing ? t('es.allowed') : t('es.blocked')}
              </StatusBadge>
              {domain.blockedReason && <span className="muted">{domain.blockedReason}</span>}
            </dd>
          </div>
          <div>
            <dt>{t('es.requiredPassing')}</dt>
            <dd className="num">
              {t('es.of', { a: passing, b: required.length })}
            </dd>
          </div>
          <div>
            <dt>{t('es.dmarcPolicy')}</dt>
            <dd>{domain.dmarcPolicy ? <code>p={domain.dmarcPolicy}</code> : <span className="muted">{t('es.notPublished')}</span>}</dd>
          </div>
          <div>
            <dt>{t('es.lastCheck')}</dt>
            <dd>{domain.lastCheckedAt ? formatTime(domain.lastCheckedAt) : <span className="muted">{t('s.never')}</span>}</dd>
          </div>
        </dl>
      </div>

      {domain.esp.placeholder && (
        <Alert tone="warning" title={t('lg.es.placeholderTitle')}>
          {t('lg.es.placeholderBody')}
        </Alert>
      )}

      <div role="status" aria-live="polite" className="stack stack--sm">
        {verify.isError && (
          <Alert tone="danger" title={t('lg.es.checkFailed')}>
            {verify.error.message}. {t('lg.es.tryAgain')}
          </Alert>
        )}
        {verify.isSuccess && (
          <span className="visually-hidden">
            {t(domain.canSendMarketing ? 'lg.es.checkedAllowed' : 'lg.es.checkedBlocked', { a: passing, b: required.length })}
          </span>
        )}
      </div>

      <DataTable
        caption={t('lg.es.recordsCaption', { domain: domain.domain })}
        columns={recordColumns(domain.domain, t)}
        rows={domain.records}
        rowKey={(record) => `${record.kind}:${record.host}`}
      />
      <p className="muted dns-note">{t('lg.es.recordsNote', { button: t('es.checkNow') })}</p>

      <WarmupSection domain={domain} canManage={canManage} onUpdated={replace} />

      <ConfirmDialog
        open={confirmRemove}
        title={t('lg.es.removeTitle', { domain: domain.domain })}
        confirmLabel={t('lg.es.removeConfirm')}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmRemove(false)}
      >
        <p>{t('lg.es.removeBody', { domain: domain.domain })}</p>
        {remove.isError && (
          <Alert tone="danger" title={t('lg.es.removeFailed')}>
            {remove.error.message}
          </Alert>
        )}
      </ConfirmDialog>
    </section>
  );
}

function AddDomainForm() {
  const t = useT();
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
          <h2 id="add-domain-heading">{t('lg.es.addTitle')}</h2>
        </div>
        <div className="add-domain">
          <TextField
            label={t('lg.es.subdomain')}
            name="domain"
            required
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            placeholder="news.academy-domain.am"
            hint={t('lg.es.subdomainHint')}
            value={value}
            error={fieldError}
            onChange={(event) => {
              setValue(event.target.value);
              if (add.isError) add.reset();
            }}
          />
          <Button type="submit" variant="primary" loading={add.isPending} disabled={value.trim() === ''}>
            {t('lg.es.addButton')}
          </Button>
        </div>
        <div role="status" aria-live="polite">
          {add.isSuccess && (
            <Alert tone="success" title={t('lg.es.added', { domain: add.data.domain })}>
              {t('lg.es.addedBody', { button: t('es.checkNow') })}
            </Alert>
          )}
          {add.isError && !fieldError && (
            <Alert tone="danger" title={t('lg.es.addFailed')}>
              {add.error.message}
            </Alert>
          )}
        </div>
      </form>
    </section>
  );
}

/** Guardrails (PRD 7.4): the thresholds that pause a send by themselves, read-only. */
function GuardrailsCard() {
  const t = useT();
  const role = useStaffRole();
  const guardrails = useQuery({ queryKey: ['guardrails', role], queryFn: getGuardrails, retry: retryServerErrors });
  const g = guardrails.data?.guardrails;
  const percent = (value: number) => formatPercent(value, undefined, { maximumFractionDigits: 1 });
  const rows: { label: string; hint: string; value: string }[] = g
    ? [
        { label: t('es.g.hardBounce'), hint: t('es.g.hardBounceHint', { n: formatNumber(g.hardBounceWindow) }), value: percent(g.hardBounceRate) },
        { label: t('es.g.complaint'), hint: t('es.g.complaintHint'), value: percent(g.complaintRate) },
        { label: t('es.g.importBounce'), hint: t('es.g.importBounceHint'), value: percent(g.importFirstSendBounceRate) },
        { label: t('es.g.minimum'), hint: t('es.g.minimumHint'), value: formatNumber(g.minimumSample) },
        { label: t('es.g.softBounces'), hint: t('es.g.softBouncesHint', { days: g.softBounceWindowDays }), value: formatNumber(g.softBouncesToSuppress) },
      ]
    : [];
  return (
    <section className="card stack" aria-labelledby="guardrails-heading">
      <div className="cluster">
        <span className="icon-tile icon-tile--sm icon-tile--brand">
          <ShieldCheck size={20} weight="bold" aria-hidden />
        </span>
        <h2 id="guardrails-heading">{t('es.guardrails')}</h2>
      </div>
      <p className="muted">{t('es.guardrailsHint')}</p>
      {guardrails.isPending ? (
        <SkeletonCard />
      ) : (
        <dl className="facts">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                <span className="num">{row.value}</span>
                <span className="muted text-xs text-wrap"> {row.hint}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/**
 * Email settings (PRD 13.6; RESTRUCTURE R5): sending domains with the exact DNS records and their live status
 * (EML-02), whether marketing email may leave from each domain (EML-03), the warm-up plan (EML-08), DMARC reports
 * (EML-07), the guardrails (7.4) and the kill switch (EML-14). Admins manage domains; marketing managers view and re-check.
 */
export function EmailSettingsPage() {
  const t = useT();
  const role = useStaffRole();
  const canManage = role === 'admin';
  // The role is part of the key: switching the mock role refetches with the new token.
  const domains = useQuery({ queryKey: [...DOMAINS_KEY, role], queryFn: listDomains, retry: retryServerErrors });
  const dmarc = useQuery({ queryKey: ['dmarc', role], queryFn: () => dmarcSummary(30), enabled: domains.isSuccess });
  const kill = useKillSwitch();
  const data = domains.data;
  const access = accessProblem(domains.error);

  const required = data?.domains.flatMap((domain) => domain.records.filter((record) => record.requiredForSending)) ?? [];
  const passing = required.filter((record) => record.status === 'verified').length;
  const authenticated = data?.domains.filter((domain) => domain.status === 'verified').length ?? 0;
  const paused = kill.data?.paused === true;

  return (
    <>
      <PageHeader title={t('nav.emailSettings')} description={t('es.description')} actions={!access && <KillSwitchButton />} />
      {access ? (
        <AccessNotice problem={access} title={t('es.access')}>
          {t('es.accessHint')}
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          <KillSwitchBanner link={false} />
          <div className="grid-12">
            {domains.isPending ? (
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="span-3">
                  <SkeletonTile />
                </div>
              ))
            ) : (
              <>
                <div className="span-3">
                  <StatTile tone="yellow" label={t('es.tileDomains')} value={data ? t('es.of', { a: authenticated, b: data.domains.length }) : '—'} caption={t('es.tileDomainsCaption', { n: data?.domains.length ?? 0 })} definition={t('es.tileDomainsDefinition')} />
                </div>
                <div className="span-3">
                  <StatTile label={t('es.tileRecords')} value={required.length > 0 ? t('es.of', { a: passing, b: required.length }) : '—'} caption={t('es.tileRecordsCaption')} definition={t('es.tileRecordsDefinition')} />
                </div>
                <div className="span-3">
                  <StatTile
                    label={t('es.tileDmarc')}
                    value={dmarc.data?.passRate == null ? '—' : formatPercent(dmarc.data.passRate)}
                    caption={dmarc.data?.passRate == null ? t('es.tileDmarcNone') : t('es.tileDmarcCaption')}
                    definition={t('es.tileDmarcDefinition')}
                  />
                </div>
                <div className="span-3">
                  <StatTile label={t('es.tileSending')} value={kill.data ? (paused ? t('es.sendingOff') : t('es.sendingOn')) : '—'} caption={paused ? t('es.sendingCaptionOff') : t('es.sendingCaption')} definition={t('es.sendingDefinition')} />
                </div>
              </>
            )}
          </div>
          {canManage && <AddDomainForm />}
          {domains.isError && !access && (
            <Alert
              tone="danger"
              title={t('es.loadFailed')}
              action={
                <Button size="sm" variant="secondary" onClick={() => void domains.refetch()}>
                  {t('s.retry')}
                </Button>
              }
            >
              {domains.error.message}
            </Alert>
          )}
          {data && data.domains.length === 0 && (
            <section className="card">
              <EmptyState title={t('es.noDomains')} icon={<GlobeSimple size={28} weight="bold" aria-hidden />}>
                {canManage ? t('es.noDomainsAdmin') : t('es.noDomainsOther')}
              </EmptyState>
            </section>
          )}
          {data?.domains.map((domain) => <DomainCard key={domain.id} domain={domain} canManage={canManage} />)}
          <div className="grid-12">
            <div className="span-7">
              <DmarcSection />
            </div>
            <div className="span-5">
              <GuardrailsCard />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
