import { CalendarPlus, FileArrowUp } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, createCost, createManualEvent, importAttendees, type EventRow } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { useT } from '../lib/i18n';
import { useStaffRole } from '../lib/session';
import { Alert, Button, SelectField, TextField } from '../ui';

const blankEvent = () => ({ title: '', type: 'open_day', date: '', time: '12:00', language: 'hy', public: true, registrationUrl: '' });

/** PRD 10.5 fallback while Event Hub is not connected: events entered by hand, attendee CSV with consent, event costs. */
export function ManualEvents({ events, stacked = false }: { events: EventRow[]; /** One column, for the side panel. */ stacked?: boolean }) {
  const t = useT();
  const role = useStaffRole();
  const canCost = role === 'admin' || role === 'marketing_manager';
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['events'] });
  const [form, setForm] = useState(blankEvent);
  const create = useMutation({
    mutationFn: () =>
      createManualEvent({
        title: form.title,
        type: form.type,
        // Yerevan time (UTC+4, no daylight saving).
        startsAt: `${form.date}T${form.time}:00+04:00`,
        language: (form.language || null) as 'hy' | 'en' | 'ru' | null,
        public: form.public,
        registrationUrl: form.registrationUrl.trim() || null,
        registrationOpen: Boolean(form.registrationUrl.trim()),
      }),
    onSuccess: (event) => {
      setForm(blankEvent());
      setSelected(event.id);
      refresh();
    },
  });
  const createError = create.error instanceof ApiError ? create.error : null;

  const manual = events.filter((event) => event.source === 'manual');
  const [selected, setSelected] = useState('');
  const event = manual.find((item) => item.id === selected) ?? manual[0];
  const [file, setFile] = useState<File | null>(null);
  const [attendedByDefault, setAttendedByDefault] = useState(true);
  const upload = useMutation({ mutationFn: async () => importAttendees(event!.id, await file!.text(), attendedByDefault), onSuccess: refresh });
  const uploadError = upload.error instanceof ApiError ? upload.error : null;
  const [cost, setCost] = useState({ description: '', amount: '', currency: 'AMD' });
  const addCost = useMutation({
    mutationFn: () =>
      createCost({
        channel: 'events',
        campaign: event!.campaign,
        description: cost.description,
        dateFrom: event!.startsAt.slice(0, 10),
        dateTo: event!.startsAt.slice(0, 10),
        amount: Number(cost.amount.replace(/\s/g, '').replace(',', '.')),
        currency: cost.currency,
      }),
    onSuccess: () => {
      setCost({ description: '', amount: '', currency: 'AMD' });
      refresh();
    },
  });

  return (
    <div className={stacked ? 'stack stack--lg' : 'grid grid--2'}>
      <section className="card stack" aria-labelledby="add-event-heading">
        <div className="cluster">
          <span className="icon-tile icon-tile--sm icon-tile--brand">
            <CalendarPlus size={20} weight="bold" aria-hidden />
          </span>
          <h2 id="add-event-heading">{t('me.addTitle')}</h2>
        </div>
        <p className="muted">{t('me.addHint')}</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <TextField label={t('me.title')} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={createError?.details.field === 'title' ? createError.message : undefined} />
          <div className="form-row">
            <SelectField label={t('me.type')} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={['open_day', 'workshop', 'info_session', 'meetup', 'graduation', 'guest_visit', 'other'].map((value) => ({ value, label: t(`ev.type.${value}` as 'ev.type.other') }))} />
            <SelectField
              label={t('r.language')}
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
              options={[
                { value: 'hy', label: t('r.lang.hy') },
                { value: 'en', label: t('r.lang.en') },
                { value: 'ru', label: t('r.lang.ru') },
                { value: '', label: t('me.mixed') },
              ]}
            />
          </div>
          <div className="form-row">
            <TextField label={t('ev.date')} type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <TextField label={t('me.startsAt')} type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </div>
          <TextField
            label={t('me.registrationPage')}
            type="url"
            placeholder="https://"
            hint={t('me.registrationHint')}
            value={form.registrationUrl}
            onChange={(e) => setForm({ ...form, registrationUrl: e.target.value })}
            error={createError?.details.field === 'registrationUrl' ? t('me.httpsOnly') : undefined}
          />
          <label className="check">
            <input type="checkbox" checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} />
            <span>{t('me.publicEvent')}</span>
          </label>
          <div className="cluster">
            <Button type="submit" variant="secondary" disabled={!form.title.trim() || !form.date} loading={create.isPending}>
              {t('me.addEvent')}
            </Button>
          </div>
          {createError && !['title', 'registrationUrl'].includes(createError.details.field ?? '') && <Alert tone="danger" title={t('m.notSaved')}>{createError.message}</Alert>}
        </form>
      </section>

      <section className="card stack" aria-labelledby="attendees-heading">
        <div className="cluster">
          <span className="icon-tile icon-tile--sm icon-tile--brand">
            <FileArrowUp size={20} weight="bold" aria-hidden />
          </span>
          <h2 id="attendees-heading">{t('me.attendeesTitle')}</h2>
        </div>
        {manual.length === 0 ? (
          <p className="muted">{t('me.noManual')}</p>
        ) : (
          <>
            <SelectField
              label={t('ev.event')}
              value={event?.id ?? ''}
              onChange={(e) => setSelected(e.target.value)}
              options={manual.map((item) => ({ value: item.id, label: `${formatDate(item.startsAt)} · ${item.title}` }))}
            />
            <p className="muted">
              {t('me.csvColumns')} <code>email</code>; {t('me.csvOptional')} <code>first_name, last_name, phone, language, registered_at, attended</code>,{' '}
              <code>consent_newsletter, consent_courses, consent_events, consent_alumni</code> ({t('me.csvConsent')} <code>events-hy-v1</code>). {t('me.csvRules')}
            </p>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                upload.mutate();
              }}
            >
              <TextField label={t('me.attendeeList')} type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <label className="check">
                <input type="checkbox" checked={attendedByDefault} onChange={(e) => setAttendedByDefault(e.target.checked)} />
                <span>{t('me.attendedByDefault')}</span>
              </label>
              <div className="cluster">
                <Button type="submit" variant="secondary" disabled={!file || !event} loading={upload.isPending}>
                  {t('me.importAttendees')}
                </Button>
                <span role="status" className="muted">
                  {upload.isSuccess &&
                    t('me.imported', { rows: formatNumber(upload.data.rows), registrations: formatNumber(upload.data.newRegistrations), attended: formatNumber(upload.data.attended), consents: formatNumber(upload.data.consentRecords) })}
                </span>
              </div>
              {upload.isError && (
                <Alert tone="danger" title={t('me.notImported')}>
                  {upload.error.message}
                  {uploadError?.details.rows && (
                    <ul className="list-reset">
                      {uploadError.details.rows.slice(0, 10).map((row) => (
                        <li key={`${row.line}-${row.message}`}>
                          {t('cost.line', { n: row.line })}: {row.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </Alert>
              )}
            </form>
            {canCost && (
              <form
                className="form-row form-row--end"
                onSubmit={(e) => {
                  e.preventDefault();
                  addCost.mutate();
                }}
              >
                <TextField label={t('ev.cost')} required placeholder={t('me.costPlaceholder')} value={cost.description} onChange={(e) => setCost({ ...cost, description: e.target.value })} />
                <TextField label={t('cost.amount')} required inputMode="decimal" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} />
                <SelectField label={t('cost.currency')} value={cost.currency} onChange={(e) => setCost({ ...cost, currency: e.target.value })} options={['AMD', 'USD', 'EUR', 'RUB', 'GBP'].map((code) => ({ value: code, label: code }))} />
                <Button type="submit" variant="secondary" disabled={!cost.description.trim() || !cost.amount || !event} loading={addCost.isPending}>
                  {t('cost.addCost')}
                </Button>
              </form>
            )}
            {addCost.isError && <Alert tone="danger" title={t('m.notSaved')}>{addCost.error.message}</Alert>}
          </>
        )}
      </section>
    </div>
  );
}
