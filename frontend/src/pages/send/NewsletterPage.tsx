import { CalendarCheck, Newspaper, Sparkle } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import {
  collectIssue,
  getRanking,
  listCadences,
  listIssueOverview,
  listIssues,
  listSegments,
  listSendStats,
  listTemplates,
  saveCadence,
  saveRanking,
  type Cadence,
  type CadenceInput,
  type Issue,
  type ItemType,
  type Language,
  type RankingSettings,
  type SendStats,
} from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { useT, type StringKey } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import { AccessNotice, accessProblem, Alert, Button, ChartCard, Chip, DataTable, downloadCsv, EmptyState, PageHeader, retryServerErrors, SelectField, SkeletonCard, SkeletonTile, StatTile, StatusBadge, tableCsv, TextField, type Column } from '../../ui';
import { BarChart, ExportCsvButton, PrintButton, useDateTimeLabel, useDayLabel } from '../measure/shared';
import { useContactLabels } from '../reach/ContactsPage';
import { ISSUE_TONE, percentPoints, percentText, ratio } from './shared';
import { TemplatesSection } from './Templates';

const LANGUAGES: Language[] = ['hy', 'en', 'ru'];
const WEIGHT_TYPES: ItemType[] = ['upcoming_event', 'recent_event', 'library', 'graduation', 'hire', 'new_group'];
const WEIGHT_KEY: Record<ItemType, StringKey> = {
  upcoming_event: 'nl.w.upcoming_event',
  recent_event: 'nl.w.recent_event',
  library: 'nl.w.library',
  graduation: 'nl.w.graduation',
  hire: 'nl.w.hire',
  new_group: 'nl.w.new_group',
};
const ISSUE_KEY = (status: Issue['status']) => `s.issue.${status}` as const;

type IssueRow = Issue & { blocks: number | null; aiToReview: number | null; skippedItems: number | null; stats: SendStats | null };

/** NWS-01, NWS-06 and the ranking of 8.1 step 2: when issues go out, in which languages, for which segment, and what ranks first. */
function CadenceAndRanking({ cadence, ranking, next, canEdit, onSaved }: { cadence: Cadence | null; ranking: RankingSettings | undefined; next: Issue | undefined; canEdit: boolean; onSaved: () => void }) {
  const t = useT();
  const role = useStaffRole();
  const labels = useContactLabels();
  const dateTime = useDateTimeLabel();
  const segments = useQuery({ queryKey: ['segments', role], queryFn: listSegments });
  const templates = useQuery({ queryKey: ['templates', role], queryFn: listTemplates });
  const [form, setForm] = useState<CadenceInput>(
    cadence ?? { name: 'Monthly newsletter', sendDay: 10, sendHour: 11, collectWorkingDays: 5, languages: ['hy', 'en', 'ru'], segments: {}, active: true },
  );
  const [weights, setWeights] = useState<RankingSettings | undefined>(ranking);
  const save = useMutation({
    mutationFn: async () => {
      await saveCadence(form, cadence?.id);
      if (weights && ranking && JSON.stringify(weights) !== JSON.stringify(ranking)) await saveRanking(weights);
    },
    onSuccess: onSaved,
  });
  const set = <K extends keyof CadenceInput>(key: K, value: CadenceInput[K]) => setForm({ ...form, [key]: value });
  const number = (value: string, fallback: number) => (value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback);

  return (
    <section className="card stack" aria-labelledby="cadence-heading">
      <div className="cluster">
        <span className="icon-tile icon-tile--sm icon-tile--brand">
          <CalendarCheck size={20} weight="bold" aria-hidden />
        </span>
        <h2 id="cadence-heading">{t('nl.cadence')}</h2>
      </div>
      <p className="muted">{next ? t('nl.cadenceNext', { date: dateTime(next.plannedSendAt), days: form.collectWorkingDays }) : cadence ? t('nl.cadenceIdle') : t('nl.cadenceNone')}</p>
      <fieldset className="fieldset" disabled={!canEdit}>
        <legend className="fieldset__legend">{t('nl.cadence')}</legend>
        <div className="form-row">
          <TextField label={t('nl.name')} value={form.name} onChange={(e) => set('name', e.target.value)} />
          <TextField label={t('nl.sendDay')} type="number" min={1} max={28} value={form.sendDay} onChange={(e) => set('sendDay', number(e.target.value, 10))} />
          <TextField label={t('nl.sendHour')} type="number" min={0} max={23} value={form.sendHour} onChange={(e) => set('sendHour', number(e.target.value, 11))} />
          <TextField label={t('nl.collectDays')} type="number" min={1} max={15} value={form.collectWorkingDays} onChange={(e) => set('collectWorkingDays', number(e.target.value, 5))} />
          <SelectField
            label={t('nl.template')}
            options={[{ value: '', label: t('nl.defaultLook') }, ...(templates.data?.templates.map((tpl) => ({ value: tpl.id, label: `${tpl.name} (v${tpl.version})` })) ?? [])]}
            value={form.templateId ?? ''}
            onChange={(e) => set('templateId', e.target.value || null)}
          />
        </div>
      </fieldset>
      <fieldset className="fieldset" disabled={!canEdit}>
        <legend className="fieldset__legend">{t('nl.languages')}</legend>
        <div className="stack">
        <div className="cluster" role="group" aria-label={t('nl.languages')}>
          {LANGUAGES.map((language) => (
            <Chip key={language} selected={form.languages.includes(language)} onClick={() => set('languages', form.languages.includes(language) ? form.languages.filter((l) => l !== language) : [...form.languages, language])}>
              {labels.language(language)}
            </Chip>
          ))}
        </div>
        <div className="form-row">
          {form.languages.map((language) => (
            <SelectField
              key={language}
              label={t('nl.segmentFor', { language: labels.language(language) })}
              hint={t('nl.segmentHint')}
              options={[{ value: '', label: t('nl.segmentLater') }, ...(segments.data?.segments.map((s) => ({ value: s.id, label: s.name })) ?? [])]}
              value={form.segments[language] ?? ''}
              onChange={(e) => set('segments', { ...form.segments, [language]: e.target.value || undefined })}
            />
          ))}
        </div>
        </div>
      </fieldset>
      {weights && (
        <fieldset className="fieldset" disabled={!canEdit}>
          <legend className="fieldset__legend">{t('nl.weights')}</legend>
          <p className="muted">{t('nl.weightsHint')}</p>
          <div className="weights-grid">
            {WEIGHT_TYPES.map((type) => (
              <TextField
                key={type}
                label={t(WEIGHT_KEY[type])}
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={weights.weights[type]}
                onChange={(e) => setWeights({ ...weights, weights: { ...weights.weights, [type]: number(e.target.value, weights.weights[type]) } })}
              />
            ))}
            <TextField label={t('nl.halfLife')} type="number" min={1} max={120} value={weights.halfLifeDays} onChange={(e) => setWeights({ ...weights, halfLifeDays: number(e.target.value, weights.halfLifeDays) })} />
          </div>
        </fieldset>
      )}
      {canEdit ? (
        <div className="cluster">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {cadence ? t('nl.save') : t('nl.start')}
          </Button>
          <span role="status" className="muted">{save.isSuccess ? t('nl.saved') : ''}</span>
        </div>
      ) : (
        <p className="muted">{t('nl.managersOnly')}</p>
      )}
      {save.isError && <Alert tone="danger" title={t('nl.notSaved')}>{save.error.message}</Alert>}
    </section>
  );
}

/**
 * Newsletter (PRD 8, 13.6; RESTRUCTURE R5): the issues with their status, blocks and results, a chart of how each
 * edition did, the cadence and ranking settings, and the templates.
 */
export function NewsletterPage() {
  const t = useT();
  const role = useStaffRole();
  const labels = useContactLabels();
  const day = useDayLabel();
  const dateTime = useDateTimeLabel();
  const queryClient = useQueryClient();
  const issues = useQuery({ queryKey: ['issues', role], queryFn: listIssues, retry: retryServerErrors });
  const overview = useQuery({ queryKey: ['issues-overview', role], queryFn: listIssueOverview, retry: retryServerErrors });
  const stats = useQuery({ queryKey: ['send-stats', role], queryFn: listSendStats, retry: retryServerErrors });
  const cadences = useQuery({ queryKey: ['cadences', role], queryFn: listCadences, retry: retryServerErrors });
  const ranking = useQuery({ queryKey: ['ranking', role], queryFn: getRanking, retry: retryServerErrors });
  const access = accessProblem(issues.error ?? cadences.error);
  const canEdit = role === 'admin' || role === 'marketing_manager';
  const refresh = () => {
    for (const key of ['cadences', 'issues', 'issues-overview', 'ranking', 'send-stats']) void queryClient.invalidateQueries({ queryKey: [key] });
  };

  const rows: IssueRow[] = (issues.data?.issues ?? []).map((issue) => {
    const extra = overview.data?.overview.find((item) => item.issueId === issue.id);
    return { ...issue, blocks: extra?.blocks ?? null, aiToReview: extra?.aiToReview ?? null, skippedItems: extra?.skippedItems ?? null, stats: stats.data?.stats.find((item) => item.sendId === issue.sendId) ?? null };
  });
  const clickRate = (row: IssueRow) => (row.stats ? ratio(row.stats.clicked, row.stats.sent) : null);
  const sentRows = rows.filter((row) => row.stats && row.stats.sent > 0).sort((a, b) => a.plannedSendAt.localeCompare(b.plannedSendAt));
  const upcoming = [...rows].filter((row) => row.status !== 'sent').sort((a, b) => a.plannedSendAt.localeCompare(b.plannedSendAt));
  const next = upcoming[0];
  const collectable = upcoming.find((row) => row.status === 'collecting');
  const latest = sentRows.at(-1);
  const waiting = rows.filter((row) => row.status === 'draft' || row.status === 'in_review').length;
  const aiTexts = rows.filter((row) => row.status !== 'sent').reduce((sum, row) => sum + (row.aiToReview ?? 0), 0);
  const collect = useMutation({ mutationFn: (id: string) => collectIssue(id), onSuccess: refresh });

  const columns: Column<IssueRow>[] = [
    {
      key: 'issue',
      header: t('nl.issue'),
      render: (row) => (
        <span className="stack stack--xs issue-cell">
          <a href={`#/newsletter/${row.id}`}>{row.subject ?? row.edition}</a>
          {row.preheader && <span className="muted text-xs text-wrap">{row.preheader}</span>}
        </span>
      ),
      sortValue: (row) => `${row.edition} ${row.language}`,
      csv: (row) => row.subject ?? row.edition,
    },
    { key: 'language', header: t('nl.language'), render: (row) => labels.language(row.language), sortValue: (row) => row.language },
    { key: 'status', header: t('nl.status'), render: (row) => <StatusBadge tone={ISSUE_TONE[row.status]}>{t(ISSUE_KEY(row.status))}</StatusBadge>, sortValue: (row) => row.status, csv: (row) => t(ISSUE_KEY(row.status)) },
    { key: 'since', header: t('nl.coversSince'), definition: t('nl.coversSinceDefinition'), render: (row) => <span className="num nowrap">{day(row.periodStart, true)}</span>, sortValue: (row) => row.periodStart },
    { key: 'planned', header: t('nl.plannedSend'), render: (row) => <span className="num nowrap">{dateTime(row.plannedSendAt)}</span>, sortValue: (row) => row.plannedSendAt },
    { key: 'blocks', header: t('nl.blocks'), numeric: true, render: (row) => (row.blocks === null ? '—' : formatNumber(row.blocks)), sortValue: (row) => row.blocks ?? -1 },
    {
      key: 'ai',
      header: t('nl.aiReview'),
      definition: t('nl.aiReviewDefinition'),
      numeric: true,
      render: (row) => (row.aiToReview === null ? '—' : row.aiToReview > 0 && row.status !== 'sent' ? <StatusBadge tone="warning">{formatNumber(row.aiToReview)}</StatusBadge> : formatNumber(row.aiToReview)),
      sortValue: (row) => row.aiToReview ?? -1,
    },
    { key: 'skipped', header: t('nl.skipped'), definition: t('nl.skippedDefinition'), numeric: true, render: (row) => (row.skippedItems === null ? '—' : formatNumber(row.skippedItems)), sortValue: (row) => row.skippedItems ?? -1 },
    {
      key: 'click',
      header: t('s.clickRate'),
      definition: t('s.clickRateDefinition'),
      numeric: true,
      render: (row) => percentText(clickRate(row)),
      sortValue: (row) => clickRate(row) ?? -1,
      csv: (row) => (clickRate(row) === null ? null : percentPoints(clickRate(row))),
      bar: (row) => clickRate(row),
    },
  ];

  // Chart data: one group per edition, one bar per language.
  const editions = [...new Set(sentRows.map((row) => row.edition))].sort();
  const forEdition = (edition: string, language: Language) => sentRows.find((row) => row.edition === edition && row.language === language);
  const clickData = editions.map((edition) => ({
    edition,
    hy: percentPoints(clickRateOf(forEdition(edition, 'hy'))),
    en: percentPoints(clickRateOf(forEdition(edition, 'en'))),
    ru: percentPoints(clickRateOf(forEdition(edition, 'ru'))),
  }));
  const sentData = editions.map((edition) => ({
    edition,
    hy: forEdition(edition, 'hy')?.stats?.sent ?? 0,
    en: forEdition(edition, 'en')?.stats?.sent ?? 0,
    ru: forEdition(edition, 'ru')?.stats?.sent ?? 0,
  }));
  const languageSeries = LANGUAGES.map((language) => ({ key: language, label: labels.language(language) }));
  const best = sentRows.reduce<IssueRow | null>((top, row) => (top === null || (clickRate(row) ?? -1) > (clickRate(top) ?? -1) ? row : top), null);
  const totalSent = sentRows.reduce((sum, row) => sum + (row.stats?.sent ?? 0), 0);
  const totalUnsub = sentRows.reduce((sum, row) => sum + (row.stats?.unsubscribed ?? 0), 0);
  const percentFormat = (value: number) => `${formatNumber(value, undefined, { maximumFractionDigits: 1 })}%`;
  const loading = issues.isPending || stats.isPending;

  return (
    <>
      <PageHeader
        title={t('nav.newsletter')}
        description={t('nl.description')}
        actions={
          !access && (
            <>
              <ExportCsvButton disabled={rows.length === 0} onExport={() => downloadCsv('newsletter-issues', tableCsv(columns, rows))} />
              <PrintButton disabled={rows.length === 0} />
              {collectable && (
                <Button variant="primary" icon={<Sparkle size={18} weight="bold" aria-hidden />} loading={collect.isPending} title={t('nl.collectNowHint')} onClick={() => collect.mutate(collectable.id)}>
                  {t('nl.collectNow')}
                </Button>
              )}
            </>
          )
        }
      />
      {access ? (
        <AccessNotice problem={access} title={t('nl.access')}>
          {t('nl.accessHint')}
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          {(issues.isError || collect.isError) && <Alert tone="danger" title={t('s.notLoaded')}>{(issues.error ?? collect.error)?.message}</Alert>}
          <div className="grid-12">
            {loading ? (
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="span-3">
                  <SkeletonTile />
                </div>
              ))
            ) : (
              <>
                <div className="span-3">
                  <StatTile tone="yellow" label={t('nl.tileSent')} value={formatNumber(editions.length)} caption={t('nl.tileSentCaption', { n: formatNumber(sentRows.length) })} definition={t('nl.tileSentDefinition')} />
                </div>
                <div className="span-3">
                  <StatTile
                    label={t('nl.tileClick')}
                    value={latest ? percentText(clickRate(latest)) : '—'}
                    caption={latest ? t('nl.tileClickCaption', { issue: `${latest.edition} · ${labels.language(latest.language)}`, sent: formatNumber(latest.stats?.sent ?? 0) }) : t('s.summaryNone')}
                    definition={t('s.clickRateDefinition')}
                    spark={sentRows.length > 1 ? sentRows.map((row) => percentPoints(clickRate(row))) : undefined}
                  />
                </div>
                <div className="span-3">
                  <StatTile label={t('nl.tileNext')} value={next ? day(next.plannedSendAt, true) : '—'} caption={next ? t('nl.tileNextCaption', { date: day(next.collectAt) }) : undefined} definition={t('nl.tileNextDefinition')} />
                </div>
                <div className="span-3">
                  <StatTile label={t('nl.tileAttention')} value={formatNumber(waiting)} caption={t('nl.tileAttentionCaption', { drafts: formatNumber(waiting), ai: formatNumber(aiTexts) })} definition={t('nl.tileAttentionDefinition')} />
                </div>
              </>
            )}
          </div>
          <div className="grid-12">
            <Suspense fallback={<SkeletonCard />}>
              <ChartCard
                className="span-7"
                title={t('nl.chartClick')}
                description={t('nl.chartClickHint')}
                definition={t('s.clickRateDefinition')}
                summary={best ? t('nl.chartClickSummary', { issue: `${best.edition} · ${labels.language(best.language)}`, rate: percentText(clickRate(best)) }) : t('chart.noData')}
                loading={loading}
                empty={!loading && clickData.length === 0}
                table={{
                  columns: [
                    { key: 'edition', header: t('nl.edition'), sortValue: (row) => row.edition },
                    ...LANGUAGES.map((language) => ({ key: language, header: labels.language(language), numeric: true, render: (row: (typeof clickData)[number]) => percentFormat(row[language]), sortValue: (row: (typeof clickData)[number]) => row[language] })),
                  ],
                  rows: clickData,
                  rowKey: (row) => row.edition,
                  exportFile: 'newsletter-click-rate',
                }}
              >
                <BarChart data={clickData} categoryKey="edition" series={languageSeries} format={percentFormat} label={t('nl.chartClick')} />
              </ChartCard>
              <ChartCard
                className="span-5"
                title={t('nl.chartSent')}
                description={t('nl.chartSentHint')}
                summary={sentRows.length > 0 ? t('nl.chartSentSummary', { sent: formatNumber(totalSent), n: formatNumber(editions.length), unsub: formatNumber(totalUnsub) }) : t('chart.noData')}
                loading={loading}
                empty={!loading && sentData.length === 0}
                table={{
                  columns: [
                    { key: 'edition', header: t('nl.edition'), sortValue: (row) => row.edition },
                    ...LANGUAGES.map((language) => ({ key: language, header: labels.language(language), numeric: true, render: (row: (typeof sentData)[number]) => formatNumber(row[language]), sortValue: (row: (typeof sentData)[number]) => row[language] })),
                  ],
                  rows: sentData,
                  rowKey: (row) => row.edition,
                  exportFile: 'newsletter-recipients',
                }}
              >
                <BarChart data={sentData} categoryKey="edition" series={languageSeries} stacked label={t('nl.chartSent')} />
              </ChartCard>
            </Suspense>
          </div>
          <section className="card stack" aria-labelledby="issues-heading">
            <h2 id="issues-heading">{t('nl.issues')}</h2>
            <DataTable
              caption={t('nl.issues')}
              captionHidden
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              loading={issues.isPending}
              initialSort={{ key: 'planned', direction: 'descending' }}
              pageSize={10}
              dense
              empty={
                <EmptyState title={t('nl.empty')} icon={<Newspaper size={28} weight="bold" aria-hidden />}>
                  {t('nl.emptyHint')}
                </EmptyState>
              }
            />
          </section>
          {cadences.data && (ranking.data || ranking.isError) && (
            <CadenceAndRanking
              key={`${cadences.data.cadences[0]?.id ?? 'new'}:${ranking.data ? 'r' : 'x'}`}
              cadence={cadences.data.cadences[0] ?? null}
              ranking={ranking.data?.ranking}
              next={next}
              canEdit={canEdit}
              onSaved={refresh}
            />
          )}
          <TemplatesSection />
        </div>
      )}
    </>
  );
}

function clickRateOf(row: IssueRow | undefined): number | null {
  return row?.stats ? ratio(row.stats.clicked, row.stats.sent) : null;
}
