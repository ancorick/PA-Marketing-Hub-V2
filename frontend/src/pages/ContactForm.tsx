import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ApiError,
  createContact,
  listChannels,
  updateContact,
  type Contact,
  type ContactInput,
  type ContactType,
  type Language,
} from '../lib/api';
import { contactPath, LANGUAGE_LABEL, options, TYPE_LABEL, yerevanDate } from '../lib/contacts';
import { Alert, Button, SelectField, TextField } from '../ui';

type Values = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  language: Language;
  type: ContactType;
  sourceChannel: string;
  sourceCampaign: string;
  firstTouchAt: string;
  tags: string;
  corePersonId: string;
};

const EMPTY: Values = {
  email: '',
  firstName: '',
  lastName: '',
  phone: '',
  language: 'hy',
  type: 'subscriber',
  sourceChannel: '',
  sourceCampaign: '',
  firstTouchAt: '',
  tags: '',
  corePersonId: '',
};

const fromContact = (contact: Contact): Values => ({
  email: contact.email ?? '',
  firstName: contact.firstName ?? '',
  lastName: contact.lastName ?? '',
  phone: contact.phone ?? '',
  language: contact.language,
  type: contact.type,
  sourceChannel: contact.sourceChannel ?? '',
  sourceCampaign: contact.sourceCampaign ?? '',
  firstTouchAt: yerevanDate(contact.firstTouchAt),
  tags: contact.tags.join(', '),
  corePersonId: contact.corePersonId ?? '',
});

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

function toInput(values: Values): ContactInput {
  return {
    email: values.email.trim(),
    firstName: orNull(values.firstName),
    lastName: orNull(values.lastName),
    phone: orNull(values.phone),
    language: values.language,
    type: values.type,
    sourceChannel: values.sourceChannel,
    sourceCampaign: orNull(values.sourceCampaign),
    ...(values.firstTouchAt && { firstTouchAt: values.firstTouchAt }),
    tags: values.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    ...(values.corePersonId.trim() && { corePersonId: values.corePersonId.trim() }),
  };
}

/** Only the fields staff changed, so an untouched date or type is never rewritten (and never audited). */
function changedFields(values: Values, initial: Values): Partial<ContactInput> {
  const next = toInput(values);
  const before = toInput(initial);
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof ContactInput])),
  ) as Partial<ContactInput>;
}

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="fieldset">
      <legend className="fieldset__legend">{legend}</legend>
      <div className="form-row">{children}</div>
    </fieldset>
  );
}

/**
 * Add or edit a contact (AUD-02). The API owns the rules (normalization, duplicates, Core Engine link);
 * its error names the field, which gets the message and focus (WCAG 3.3.1).
 */
export function ContactForm({
  contact,
  onSaved,
  onCancel,
}: {
  /** Absent = create. */
  contact?: Contact;
  onSaved: (contact: Contact) => void;
  onCancel?: () => void;
}) {
  const initial = contact ? fromContact(contact) : EMPTY;
  const [values, setValues] = useState<Values>(initial);
  const formRef = useRef<HTMLFormElement>(null);
  const channels = useQuery({ queryKey: ['audience-channels'], queryFn: listChannels, staleTime: Infinity });
  const linked = Boolean(contact?.corePersonId);

  const save = useMutation({
    mutationFn: () => (contact ? updateContact(contact.id, changedFields(values, initial)) : createContact(toInput(values))),
    onSuccess: onSaved,
    onError: (error) => {
      const field = error instanceof ApiError ? error.details.field : null;
      const input = field ? formRef.current?.elements.namedItem(field) : null;
      if (input instanceof HTMLElement) input.focus();
    },
  });

  const apiError = save.error instanceof ApiError ? save.error : null;
  const errorField = apiError?.details.field ?? null;
  const fieldError = (name: keyof Values): ReactNode => {
    if (!apiError || errorField !== name) return undefined;
    const existingId = apiError.details.existingId;
    return (
      <>
        {apiError.message}
        {existingId && (
          <>
            {' '}
            <a href={contactPath(existingId)}>Open the existing contact</a>
          </>
        )}
      </>
    );
  };

  const set =
    <K extends keyof Values>(key: K) =>
    (event: { target: { value: string } }) => {
      setValues((current) => ({ ...current, [key]: event.target.value as Values[K] }));
      if (save.isError) save.reset();
    };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const channelOptions = [
    { value: '', label: channels.isPending ? 'Loading channels…' : 'Choose a channel' },
    ...(channels.data?.channels.map((channel) => ({ value: channel.id, label: channel.name })) ?? []),
  ];
  const unchanged = contact !== undefined && Object.keys(changedFields(values, initial)).length === 0;

  return (
    <form ref={formRef} className="stack stack--lg" onSubmit={submit} noValidate>
      <Fieldset legend="Person">
        <TextField
          label="Email"
          name="email"
          type="email"
          required
          autoComplete="off"
          spellCheck={false}
          value={values.email}
          error={fieldError('email')}
          onChange={set('email')}
        />
        <TextField label="First name" name="firstName" autoComplete="off" value={values.firstName} error={fieldError('firstName')} onChange={set('firstName')} />
        <TextField label="Last name" name="lastName" autoComplete="off" value={values.lastName} error={fieldError('lastName')} onChange={set('lastName')} />
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          autoComplete="off"
          hint="Optional. With the country code, e.g. +374 91 234567."
          value={values.phone}
          error={fieldError('phone')}
          onChange={set('phone')}
        />
        <SelectField
          label="Preferred language"
          name="language"
          required
          options={options(LANGUAGE_LABEL)}
          value={values.language}
          error={fieldError('language')}
          onChange={set('language')}
        />
      </Fieldset>

      <Fieldset legend="Marketing">
        <SelectField
          label="Type"
          name="type"
          options={options(TYPE_LABEL)}
          value={values.type}
          disabled={linked}
          hint={
            linked
              ? 'Follows the lifecycle status in the Core Engine.'
              : 'If the email belongs to a Core Engine person, the type follows their lifecycle status.'
          }
          error={fieldError('type')}
          onChange={set('type')}
        />
        <SelectField
          label="Source channel"
          name="sourceChannel"
          required
          options={channelOptions}
          value={values.sourceChannel}
          hint="Where the person first came from (PRD 9.3)."
          error={fieldError('sourceChannel')}
          onChange={set('sourceChannel')}
        />
        <TextField
          label="Source campaign"
          name="sourceCampaign"
          autoComplete="off"
          spellCheck={false}
          placeholder="spring_open_day_2026"
          hint="Optional. The campaign code, as in utm_campaign."
          value={values.sourceCampaign}
          error={fieldError('sourceCampaign')}
          onChange={set('sourceCampaign')}
        />
        <TextField
          label="First touch"
          name="firstTouchAt"
          type="date"
          max={yerevanDate(new Date().toISOString())}
          hint={contact ? 'Earliest known marketing touch.' : 'Leave empty for today.'}
          value={values.firstTouchAt}
          error={fieldError('firstTouchAt')}
          onChange={set('firstTouchAt')}
        />
        <TextField
          label="Tags"
          name="tags"
          autoComplete="off"
          placeholder="python, open-day"
          hint="Separate tags with commas."
          value={values.tags}
          error={fieldError('tags')}
          onChange={set('tags')}
        />
      </Fieldset>

      <Fieldset legend="Core Engine">
        <TextField
          label="Core Engine person ID"
          name="corePersonId"
          autoComplete="off"
          spellCheck={false}
          readOnly={linked}
          hint={
            linked
              ? 'Linked. The link is managed by the Core Engine sync.'
              : 'Optional. Leave empty and Marketing Hub looks the email up in the Core Engine.'
          }
          value={values.corePersonId}
          error={fieldError('corePersonId')}
          onChange={set('corePersonId')}
        />
      </Fieldset>

      <div role="status" aria-live="polite">
        {apiError && !errorField && (
          <Alert tone="danger" title={contact ? 'Could not save the contact' : 'Could not add the contact'}>
            {apiError.message}
          </Alert>
        )}
        {save.isError && !apiError && (
          <Alert tone="danger" title="The backend did not answer">
            {save.error.message}. Check that the backend is running, then try again.
          </Alert>
        )}
      </div>

      <div className="cluster">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={unchanged}>
          {contact ? 'Save changes' : 'Add contact'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
