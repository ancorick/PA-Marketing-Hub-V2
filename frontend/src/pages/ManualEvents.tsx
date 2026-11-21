import { CalendarPlus, FileArrowUp } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, createCost, createManualEvent, importAttendees, type EventRow } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { useStaffRole } from '../lib/session';
import { Alert, Button, SelectField, TextField } from '../ui';
import { EVENT_TYPE_LABEL } from '../lib/events';

const blankEvent = () => ({ title: '', type: 'open_day', date: '', time: '12:00', language: 'hy', public: true, registrationUrl: '' });

/** PRD 10.5 fallback while Event Hub is not connected: events entered by hand, attendee CSV with consent, event costs. */
export function ManualEvents({ events }: { events: EventRow[] }) {
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
    <div className="grid grid--2">
      <section className="card stack" aria-labelledby="add-event-heading">
        <div className="cluster">
          <span className="icon-tile icon-tile--sm icon-tile--brand">
            <CalendarPlus size={20} weight="bold" aria-hidden />
          </span>
          <h2 id="add-event-heading">Add an event by hand</h2>
        </div>
        <p className="muted">Until Event Hub is connected. Events from Event Hub appear by themselves and are changed there.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <TextField label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={createError?.details.field === 'title' ? createError.message : undefined} />
          <div className="form-row">
            <SelectField label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={Object.entries(EVENT_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
            <SelectField
              label="Language"
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
              options={[
                { value: 'hy', label: 'Armenian' },
                { value: 'en', label: 'English' },
                { value: 'ru', label: 'Russian' },
                { value: '', label: 'Mixed' },
              ]}
            />
          </div>
          <div className="form-row">
            <TextField label="Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <TextField label="Starts at (Yerevan)" type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </div>
          <TextField
            label="Registration page"
            type="url"
            placeholder="https://"
            hint="Optional; shown in the newsletter for public upcoming events."
            value={form.registrationUrl}
            onChange={(e) => setForm({ ...form, registrationUrl: e.target.value })}
            error={createError?.details.field === 'registrationUrl' ? 'Use an https:// address' : undefined}
          />
          <label className="check">
            <input type="checkbox" checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} />
            <span>Public event (can appear in the newsletter)</span>
          </label>
          <div className="cluster">
            <Button type="submit" variant="secondary" disabled={!form.title.trim() || !form.date} loading={create.isPending}>
              Add event
            </Button>
          </div>
          {createError && !['title', 'registrationUrl'].includes(createError.details.field ?? '') && <Alert tone="danger" title="Event not added">{createError.message}</Alert>}
        </form>
      </section>

      <section className="card stack" aria-labelledby="attendees-heading">
        <div className="cluster">
          <span className="icon-tile icon-tile--sm icon-tile--brand">
            <FileArrowUp size={20} weight="bold" aria-hidden />
          </span>
          <h2 id="attendees-heading">Attendees and costs of a manual event</h2>
        </div>
        {manual.length === 0 ? (
          <p className="muted">No events entered by hand in this period yet.</p>
        ) : (
          <>
            <SelectField
              label="Event"
              value={event?.id ?? ''}
              onChange={(e) => setSelected(e.target.value)}
              options={manual.map((item) => ({ value: item.id, label: `${formatDate(item.startsAt)} · ${item.title}` }))}
            />
            <p className="muted">
              CSV columns: <code>email</code> (required); optional <code>first_name, last_name, phone, language, registered_at, attended</code> and{' '}
              <code>consent_newsletter, consent_courses, consent_events, consent_alumni</code> with the wording version the person agreed to (for example{' '}
              <code>events-hy-v1</code>; empty = no consent). Nothing is saved unless every row is valid; suppressed addresses never get consent back.
            </p>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                upload.mutate();
              }}
            >
              <TextField label="Attendee list (CSV)" type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <label className="check">
                <input type="checkbox" checked={attendedByDefault} onChange={(e) => setAttendedByDefault(e.target.checked)} />
                <span>Everyone on the list attended (unless the attended column says no)</span>
              </label>
              <div className="cluster">
                <Button type="submit" variant="secondary" disabled={!file || !event} loading={upload.isPending}>
                  Import attendees
                </Button>
                <span role="status" className="muted">
                  {upload.isSuccess &&
                    `${formatNumber(upload.data.rows)} rows: ${formatNumber(upload.data.newRegistrations)} new registrations, ${formatNumber(upload.data.attended)} attended, ${formatNumber(upload.data.consentRecords)} consent records.`}
                </span>
              </div>
              {upload.isError && (
                <Alert tone="danger" title="List not imported">
                  {upload.error.message}
                  {uploadError?.details.rows && (
                    <ul className="list-reset">
                      {uploadError.details.rows.slice(0, 10).map((row) => (
                        <li key={`${row.line}-${row.message}`}>
                          Line {row.line}: {row.message}
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
                <TextField label="Cost" required placeholder="Venue, catering…" value={cost.description} onChange={(e) => setCost({ ...cost, description: e.target.value })} />
                <TextField label="Amount" required inputMode="decimal" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} />
                <SelectField label="Currency" value={cost.currency} onChange={(e) => setCost({ ...cost, currency: e.target.value })} options={['AMD', 'USD', 'EUR', 'RUB', 'GBP'].map((code) => ({ value: code, label: code }))} />
                <Button type="submit" variant="secondary" disabled={!cost.description.trim() || !cost.amount || !event} loading={addCost.isPending}>
                  Add cost
                </Button>
              </form>
            )}
            {addCost.isError && <Alert tone="danger" title="Cost not added">{addCost.error.message}</Alert>}
          </>
        )}
      </section>
    </div>
  );
}
