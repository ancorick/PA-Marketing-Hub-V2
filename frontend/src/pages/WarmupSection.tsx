import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { updateWarmup, type SendingDomain, type Warmup, type WarmupLength } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { useT, type StringKey } from '../lib/i18n';
import { Disclosure } from '../motion';
import { Alert, Button, ConfirmDialog, DataTable, SelectField, StatusBadge, Tag, type Tone } from '../ui';

const STATUS: Record<Warmup['status'], { tone: Tone; label: StringKey }> = {
  not_started: { tone: 'neutral', label: 'lg.w.not_started' },
  active: { tone: 'warning', label: 'lg.w.active' },
  complete: { tone: 'success', label: 'lg.w.complete' },
  skipped: { tone: 'neutral', label: 'lg.w.skipped' },
};

const LENGTHS = [14, 21, 28] as const;

function Summary({ warmup }: { warmup: Warmup }) {
  const t = useT();
  const first = formatNumber(warmup.plan[0] ?? 0);
  const last = formatNumber(warmup.plan.at(-1) ?? 0);
  switch (warmup.status) {
    case 'not_started':
      return (
        <p>{t('lg.w.notStartedText', { first, days: warmup.days, last })}</p>
      );
    case 'active': {
      const cap = warmup.todayCap ?? 0;
      const used = Math.min(100, cap === 0 ? 100 : (warmup.sentToday / cap) * 100);
      const tomorrow = warmup.day !== null && warmup.day < warmup.days ? warmup.plan[warmup.day] : null;
      return (
        <div className="stack stack--sm">
          <p className="warmup__day num">{t('lg.w.day', { day: warmup.day ?? 0, days: warmup.days })}</p>
          <p className="num">{t('lg.w.sentToday', { sent: formatNumber(warmup.sentToday), cap: formatNumber(cap) })}</p>
          <span className="usage-bar" aria-hidden>
            <span className="usage-bar__fill" style={{ inlineSize: `${used}%` }} />
          </span>
          {tomorrow != null && <p className="muted">{t('lg.w.tomorrow', { n: formatNumber(tomorrow) })}</p>}
        </div>
      );
    }
    case 'complete':
      return <p>{t('lg.w.completeText')}</p>;
    case 'skipped':
      return <p>{warmup.skippedAt ? t('lg.w.skippedOnText', { date: formatDate(warmup.skippedAt) }) : t('lg.w.skippedText')}</p>;
  }
}

/**
 * EML-08: warm-up plan of a sending domain. Daily caps rise over two to four weeks; the send gate
 * stops marketing email at today's cap. Admins choose the length or skip the plan (logged).
 */
export function WarmupSection({
  domain,
  canManage,
  onUpdated,
}: {
  domain: SendingDomain;
  canManage: boolean;
  onUpdated: (domain: SendingDomain) => void;
}) {
  const t = useT();
  const { warmup } = domain;
  const [confirmSkip, setConfirmSkip] = useState(false);
  const change = useMutation({
    mutationFn: (body: { days: WarmupLength } | { skip: true }) => updateWarmup(domain.id, body),
    onSuccess: (updated) => {
      setConfirmSkip(false);
      onUpdated(updated);
    },
  });
  const headingId = `warmup-${domain.id}`;
  const status = STATUS[warmup.status];
  const editable = canManage && (warmup.status === 'not_started' || warmup.status === 'active');

  return (
    <section className="stack" aria-labelledby={headingId}>
      <div className="cluster">
        <h3 id={headingId}>{t('lg.w.title')}</h3>
        <StatusBadge tone={status.tone}>{t(status.label)}</StatusBadge>
      </div>

      <div className="inset warmup">
        <div className="stack stack--sm">
          <Summary warmup={warmup} />
          <p className="muted warmup__note">{t('lg.w.note')}</p>
        </div>
        {editable && (
          <div className="warmup__controls">
            <SelectField
              label={t('lg.w.length')}
              options={LENGTHS.map((days) => ({ value: String(days), label: t('lg.w.weeks', { n: days / 7 }) }))}
              value={String(warmup.days)}
              disabled={change.isPending}
              onChange={(event) => change.mutate({ days: Number(event.target.value) as WarmupLength })}
            />
            <Button variant="secondary" size="sm" onClick={() => setConfirmSkip(true)}>
              {t('lg.w.skip')}
            </Button>
          </div>
        )}
      </div>

      <div role="status" aria-live="polite">
        {change.isError && !confirmSkip && (
          <Alert tone="danger" title={t('lg.w.changeFailed')}>
            {change.error.message}
          </Alert>
        )}
      </div>

      <Disclosure title={t('lg.w.allCaps', { n: warmup.days })}>
        <DataTable
          caption={t('lg.w.capsCaption', { domain: domain.domain })}
          captionHidden
          columns={[
            {
              key: 'day',
              header: t('lg.w.dayCol'),
              render: (row: { day: number; cap: number }) => (
                <span className="cluster">
                  <span className="num">{t('lg.w.dayN', { n: row.day })}</span>
                  {warmup.status === 'active' && row.day === warmup.day && <Tag>{t('lg.w.today')}</Tag>}
                </span>
              ),
            },
            { key: 'cap', header: t('lg.w.emails'), numeric: true, render: (row) => formatNumber(row.cap) },
          ]}
          rows={warmup.plan.map((cap, index) => ({ day: index + 1, cap }))}
          rowKey={(row) => String(row.day)}
        />
      </Disclosure>

      <ConfirmDialog
        open={confirmSkip}
        title={t('lg.w.skipTitle', { domain: domain.domain })}
        confirmLabel={t('lg.w.skip')}
        busy={change.isPending}
        onConfirm={() => change.mutate({ skip: true })}
        onCancel={() => setConfirmSkip(false)}
      >
        <p>{t('lg.w.skipBody', { domain: domain.domain })}</p>
        {change.isError && (
          <Alert tone="danger" title={t('lg.w.skipFailed')}>
            {change.error.message}
          </Alert>
        )}
      </ConfirmDialog>
    </section>
  );
}
