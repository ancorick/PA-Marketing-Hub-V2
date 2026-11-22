import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { listTemplates, saveTemplate, type NewsletterTemplate, type TemplateInput } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { useStaffRole } from '../../lib/session';
import { Disclosure } from '../../motion';
import { Alert, Button, TextField } from '../../ui';

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

/** NWS-15: brand colours, font, logo and footer; contrast is checked on save (8.4). The form keeps its pre-R5 English text. */
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

/** Newsletter templates (managers and admins): one disclosure per template and one for a new one. */
export function TemplatesSection() {
  const t = useT();
  const role = useStaffRole();
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: ['templates', role], queryFn: listTemplates });
  if (role !== 'admin' && role !== 'marketing_manager') return null;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['templates'] });
  return (
    <section className="card stack" aria-labelledby="templates-heading">
      <h2 id="templates-heading">{t('nl.templates')}</h2>
      <p className="muted">{t('nl.templatesHint')}</p>
      {(templates.data?.templates ?? []).map((template) => (
        <Disclosure key={template.id} title={`${template.name} · v${template.version}`}>
          <TemplateForm template={template} onSaved={refresh} />
        </Disclosure>
      ))}
      <Disclosure title={t('nl.newTemplate')}>
        <TemplateForm template={null} onSaved={refresh} />
      </Disclosure>
    </section>
  );
}
