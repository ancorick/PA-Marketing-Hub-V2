import { CalendarCheck, Newspaper } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  listCadences,
  listIssues,
  listSegments,
  listTemplates,
  saveCadence,
  saveTemplate,
  type Cadence,
  type CadenceInput,
  type Issue,
  type IssueStatus,
  type Language,
  type NewsletterTemplate,
  type TemplateInput,
} from '../lib/api';
import { LANGUAGE_LABEL } from '../lib/contacts';
import { formatDate } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { Disclosure } from '../motion';
import { AccessNotice, accessProblem, Alert, Button, Chip, DataTable, EmptyState, PageHeader, retryServerErrors, SelectField, StatusBadge, TextField, type Column, type Tone } from '../ui';

export const ISSUE_STATUS: Record<IssueStatus, { tone: Tone; label: string }> = {
  collecting: { tone: 'neutral', label: 'Waiting to collect' },
  draft: { tone: 'info', label: 'Draft' },
  in_review: { tone: 'warning', label: 'Needs approval' },
  approved: { tone: 'success', label: 'Approved' },
  scheduled: { tone: 'success', label: 'Scheduled' },
  sent: { tone: 'success', label: 'Sent' },
};

const formatTime = (iso: string) => formatDate(iso, undefined, { timeStyle: 'short' });
const LANGUAGES: Language[] = ['hy', 'en', 'ru'];

/** NWS-01, NWS-06: when issues go out, in which languages and to which segment per language. */
function CadenceForm({ cadence, onSaved }: { cadence: Cadence | null; onSaved: () => void }) {
  const role = useStaffRole();
  const canEdit = role === 'admin' || role === 'marketing_manager';
  const segments = useQuery({ queryKey: ['segments', role], queryFn: listSegments });
  const templates = useQuery({ queryKey: ['templates', role], queryFn: listTemplates });
  const [form, setForm] = useState<CadenceInput>(
    cadence ?? { name: 'Monthly newsletter', sendDay: 10, sendHour: 11, collectWorkingDays: 5, languages: ['hy', 'en', 'ru'], segments: {}, active: true },
  );
  const save = useMutation({ mutationFn: () => saveCadence(form, cadence?.id), onSuccess: onSaved });
  const set = <K extends keyof CadenceInput>(key: K, value: CadenceInput[K]) => setForm({ ...form, [key]: value });
  const number = (value: string, fallback: number) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  return (
    <section className="card stack" aria-labelledby="cadence-heading">
      <div className="cluster">
        <span className="icon-tile icon-tile--sm icon-tile--brand">
          <CalendarCheck size={20} weight="bold" aria-hidden />
        </span>
        <h2 id="cadence-heading">Schedule</h2>
      </div>
      <fieldset className="fieldset" disabled={!canEdit}>
        <legend className="fieldset__legend">Cadence</legend>
        <div className="form-row">
          <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <TextField label="Send on day of the month" type="number" min={1} max={28} value={form.sendDay} onChange={(e) => set('sendDay', number(e.target.value, 10))} />
          <TextField label="Send at (Yerevan, hour)" type="number" min={0} max={23} value={form.sendHour} onChange={(e) => set('sendHour', number(e.target.value, 11))} />
          <TextField label="Draft this many working days before" type="number" min={1} max={15} value={form.collectWorkingDays} onChange={(e) => set('collectWorkingDays', number(e.target.value, 5))} />
          <SelectField
            label="Template (NWS-15)"
            options={[{ value: '', label: 'Default brand look' }, ...(templates.data?.templates.map((t) => ({ value: t.id, label: `${t.name} (v${t.version})` })) ?? [])]}
            value={form.templateId ?? ''}
            onChange={(e) => set('templateId', e.target.value || null)}
          />
        </div>
      </fieldset>
      <fieldset className="fieldset" disabled={!canEdit}>
        <legend className="fieldset__legend">Languages and segments (NWS-06)</legend>
        <div className="cluster" role="group" aria-label="Languages">
          {LANGUAGES.map((language) => (
            <Chip
              key={language}
              selected={form.languages.includes(language)}
              onClick={() => set('languages', form.languages.includes(language) ? form.languages.filter((l) => l !== language) : [...form.languages, language])}
            >
              {LANGUAGE_LABEL[language]}
            </Chip>
          ))}
        </div>
        <div className="form-row">
          {form.languages.map((language) => (
            <SelectField
              key={language}
              label={`${LANGUAGE_LABEL[language]} segment`}
              hint="Usually: newsletter consent and this language."
              options={[{ value: '', label: 'Choose later' }, ...(segments.data?.segments.map((s) => ({ value: s.id, label: s.name })) ?? [])]}
              value={form.segments[language] ?? ''}
              onChange={(e) => set('segments', { ...form.segments, [language]: e.target.value || undefined })}
            />
          ))}
        </div>
      </fieldset>
      {canEdit && (
        <div className="cluster">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {cadence ? 'Save schedule' : 'Start the newsletter'}
          </Button>
          {save.isSuccess && <span role="status" className="muted">Saved. Upcoming issues are planned.</span>}
        </div>
      )}
      {save.isError && <Alert tone="danger" title="Not saved">{save.error.message}</Alert>}
    </section>
  );
}

const EMPTY_TEMPLATE: TemplateInput = {
  name: 'Picsart Academy',
  accentColor: '#FFDC00',
  buttonTextColor: '#131317',
  backgroundColor: '#F6F5FA',
  textColor: '#121216',
  fontFamily: "'Manrope', 'Noto Sans Armenian', Arial, sans-serif",
  logoUrl: null,
  headerText: 'Picsart Academy',
  footerNote: null,
};

/** NWS-15: brand colours, font, logo and footer; contrast is checked on save (8.4). */
function TemplateForm({ template, onSaved }: { template: NewsletterTemplate | null; onSaved: () => void }) {
  const [form, setForm] = useState<TemplateInput>(template ?? EMPTY_TEMPLATE);
  const save = useMutation({ mutationFn: () => saveTemplate(form, template?.id), onSuccess: onSaved });
  const set = (key: keyof TemplateInput, value: string) => setForm({ ...form, [key]: key === 'logoUrl' || key === 'footerNote' ? value || null : value });
  const colors: [keyof TemplateInput, string][] = [
    ['accentColor', 'Button colour'],
    ['buttonTextColor', 'Button text'],
    ['backgroundColor', 'Page background'],
    ['textColor', 'Body text'],
  ];
  return (
    <div className="stack">
      <div className="form-row">
        <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
        <TextField label="Header text" value={form.headerText} onChange={(e) => set('headerText', e.target.value)} />
        <TextField label="Logo (https:// image)" value={form.logoUrl ?? ''} onChange={(e) => set('logoUrl', e.target.value)} />
        <TextField label="Font stack" hint="Web-safe fallbacks last; most clients ignore custom fonts." value={form.fontFamily} onChange={(e) => set('fontFamily', e.target.value)} />
        {colors.map(([key, label]) => (
          <TextField key={key} label={label} hint="#RRGGBB" value={form[key] as string} onChange={(e) => set(key, e.target.value)} />
        ))}
        <TextField label="Footer note" value={form.footerNote ?? ''} onChange={(e) => set('footerNote', e.target.value)} />
      </div>
      {save.isError && <Alert tone="danger" title="Template not saved">{save.error.message}</Alert>}
      <div className="cluster">
        <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>
          {template ? `Save (becomes v${template.version + 1})` : 'Create template'}
        </Button>
        {save.isSuccess && <span role="status" className="muted">Saved.</span>}
      </div>
    </div>
  );
}

function TemplatesSection() {
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: ['templates', role], queryFn: listTemplates });
  if (role !== 'admin' && role !== 'marketing_manager') return null;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['templates'] });
  return (
    <section className="card stack" aria-labelledby="templates-heading">
      <h2 id="templates-heading">Templates</h2>
      <p className="muted">Single column, 600px wide, live text, alt text on every image, footer with address, reason and unsubscribe (PRD 8.4).</p>
      {(templates.data?.templates ?? []).map((template) => (
        <Disclosure key={template.id} title={`${template.name} · v${template.version}`}>
          <TemplateForm template={template} onSaved={refresh} />
        </Disclosure>
      ))}
      <Disclosure title="New template">
        <TemplateForm template={null} onSaved={refresh} />
      </Disclosure>
    </section>
  );
}

/** Newsletter (PRD 13.6 "Newsletter issues"): schedule and the list of issues with status and dates. */
export function NewsletterPage() {
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const cadences = useQuery({ queryKey: ['cadences', role], queryFn: listCadences, retry: retryServerErrors });
  const issues = useQuery({ queryKey: ['issues', role], queryFn: listIssues, retry: retryServerErrors });
  const access = accessProblem(cadences.error);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cadences'] });
    void queryClient.invalidateQueries({ queryKey: ['issues'] });
  };
  const columns: Column<Issue>[] = [
    { key: 'edition', header: 'Issue', render: (i) => <a href={`#/newsletter/${i.id}`}>{i.subject ?? `Edition ${i.edition}`}</a>, sortValue: (i) => i.edition },
    { key: 'language', header: 'Language', render: (i) => LANGUAGE_LABEL[i.language] },
    { key: 'status', header: 'Status', render: (i) => <StatusBadge tone={ISSUE_STATUS[i.status].tone}>{ISSUE_STATUS[i.status].label}</StatusBadge> },
    { key: 'cutoff', header: 'Draft (cut-off)', render: (i) => <span className="num">{formatTime(i.cutOffAt ?? i.collectAt)}</span> },
    { key: 'planned', header: 'Planned send', render: (i) => <span className="num">{formatTime(i.plannedSendAt)}</span>, sortValue: (i) => i.plannedSendAt },
  ];
  return (
    <>
      <PageHeader title="Newsletter" accent="issues" description="Drafted from what happened at the Academy; a person edits, a manager approves." />
      {access ? (
        <AccessNotice problem={access} title="The newsletter is for editors, marketing managers and admins">
          Ask an admin if you need access.
        </AccessNotice>
      ) : (
        <div className="stack stack--lg">
          <TemplatesSection />
          {cadences.data && <CadenceForm key={cadences.data.cadences[0]?.id ?? 'new'} cadence={cadences.data.cadences[0] ?? null} onSaved={refresh} />}
          <section className="card">
            <DataTable
              caption="Issues"
              columns={columns}
              rows={issues.data?.issues ?? []}
              rowKey={(i) => i.id}
              loading={issues.isPending}
              initialSort={{ key: 'planned', direction: 'descending' }}
              empty={
                <EmptyState title="No issues yet" icon={<Newspaper size={28} weight="bold" aria-hidden />}>
                  Save the schedule: issues appear for each language, and drafts are built before the send date.
                </EmptyState>
              }
            />
          </section>
        </div>
      )}
    </>
  );
}
