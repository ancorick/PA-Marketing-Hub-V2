import { Plus, Trash } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { listChannels, type ConsentState, type OutcomeType, type SegmentCondition, type SegmentRule, type Topic, type TouchType } from '../lib/api';
import { CONSENT, LANGUAGE_LABEL, TOPIC_LABEL, TYPE_LABEL } from '../lib/contacts';
import { Button, SelectField, TextField } from '../ui';

type Kind =
  | 'type'
  | 'language'
  | 'sourceChannel'
  | 'sourceCampaign'
  | 'employmentStatus'
  | 'tag'
  | 'course'
  | 'group'
  | 'touch'
  | 'outcome'
  | 'date'
  | 'consent'
  | 'admissions'
  | 'referred_enrolled';

const KIND_LABEL: Record<Kind, string> = {
  type: 'Contact type',
  language: 'Language',
  sourceChannel: 'Source channel',
  sourceCampaign: 'Source campaign',
  employmentStatus: 'Employment (Alumni Tracker)',
  tag: 'Tag',
  course: 'Course',
  group: 'Group',
  touch: 'Did something (opened, clicked, attended…)',
  outcome: 'Applied, enrolled, completed, hired',
  date: 'Lifecycle date',
  consent: 'Consent',
  admissions: 'Admissions stage (CRM)',
  referred_enrolled: 'Referred an enrolled student',
};

const TOUCH_LABEL: Record<TouchType, string> = {
  open: 'Opened an email',
  click: 'Clicked a link',
  attendance: 'Attended an event',
  registration: 'Registered for an event',
  form: 'Filled in a form',
  visit: 'Visited the website',
  chat: 'Chatted with the chatbot',
  referral: 'Referred someone',
};

const OUTCOME_LABEL: Record<OutcomeType, string> = { lead: 'Became a lead', applied: 'Applied', enrolled: 'Enrolled', completed: 'Completed a course', hired: 'Was hired' };

const kindOf = (condition: SegmentCondition): Kind => (condition.kind === 'attribute' ? condition.field : condition.kind);

/** A sensible first condition for each kind, so a new row is valid at once. */
export function defaultCondition(kind: Kind): SegmentCondition {
  switch (kind) {
    case 'type':
      return { kind: 'attribute', field: 'type', operator: 'in', values: ['subscriber'] };
    case 'language':
      return { kind: 'attribute', field: 'language', operator: 'in', values: ['hy'] };
    case 'sourceChannel':
      return { kind: 'attribute', field: 'sourceChannel', operator: 'in', values: ['events'] };
    case 'sourceCampaign':
      return { kind: 'attribute', field: 'sourceCampaign', operator: 'in', values: [''] };
    case 'employmentStatus':
      return { kind: 'attribute', field: 'employmentStatus', operator: 'in', values: ['employed'] };
    case 'tag':
      return { kind: 'tag', operator: 'has', value: '' };
    case 'course':
      return { kind: 'course', operator: 'contains', values: [''] };
    case 'group':
      return { kind: 'group', operator: 'in', values: [''] };
    case 'touch':
      return { kind: 'touch', touchType: 'attendance', operator: 'did', withinDays: 90 };
    case 'outcome':
      return { kind: 'outcome', outcomeType: 'applied', operator: 'did_not' };
    case 'date':
      return { kind: 'date', field: 'firstTouchAt', operator: 'older_than_days', days: 180 };
    case 'consent':
      return { kind: 'consent', topic: 'newsletter', state: 'granted' };
    case 'admissions':
      return { kind: 'admissions', operator: 'not_active' };
    case 'referred_enrolled':
      return { kind: 'referred_enrolled' };
  }
}

const opts = (record: Record<string, string>) => Object.entries(record).map(([value, label]) => ({ value, label }));
const days = (value: string) => (value === '' ? undefined : Math.max(1, Math.min(3650, Number(value) || 1)));

/** Choices for list values: several values are typed comma-separated. */
function ValuesField({ label, values, hint, onChange }: { label: string; values: string[]; hint?: string; onChange: (values: string[]) => void }) {
  return (
    <TextField
      label={label}
      hint={hint ?? 'Several values: separate with commas.'}
      value={values.join(', ')}
      onChange={(event) => onChange(event.target.value.split(',').map((value) => value.trim()))}
    />
  );
}

function ConditionFields({ condition, onChange }: { condition: SegmentCondition; onChange: (next: SegmentCondition) => void }) {
  const channels = useQuery({ queryKey: ['audience-channels'], queryFn: listChannels, staleTime: Infinity });
  const channelOptions = channels.data?.channels.map((channel) => ({ value: channel.id, label: channel.name })) ?? [];
  const inOut = [
    { value: 'in', label: 'is' },
    { value: 'not_in', label: 'is not' },
  ];
  const fields: ReactNode[] = [];

  switch (condition.kind) {
    case 'attribute': {
      fields.push(
        <SelectField key="op" label="Match" options={inOut} value={condition.operator} onChange={(e) => onChange({ ...condition, operator: e.target.value as 'in' | 'not_in' })} />,
      );
      const listed: Record<string, Record<string, string>> = {
        type: TYPE_LABEL,
        language: LANGUAGE_LABEL,
        employmentStatus: { employed: 'Employed', seeking: 'Looking for a job', not_seeking: 'Not looking' },
        sourceChannel: Object.fromEntries(channelOptions.map((o) => [o.value, o.label])),
      };
      const choices = listed[condition.field];
      fields.push(
        choices ? (
          <SelectField key="value" label="Value" options={opts(choices)} value={condition.values[0] ?? ''} onChange={(e) => onChange({ ...condition, values: [e.target.value] })} />
        ) : (
          <ValuesField key="value" label="Campaign codes" values={condition.values} onChange={(values) => onChange({ ...condition, values })} />
        ),
      );
      break;
    }
    case 'tag':
      fields.push(
        <SelectField key="op" label="Match" options={[{ value: 'has', label: 'has the tag' }, { value: 'has_not', label: 'does not have the tag' }]} value={condition.operator} onChange={(e) => onChange({ ...condition, operator: e.target.value as 'has' | 'has_not' })} />,
        <TextField key="value" label="Tag" value={condition.value} onChange={(e) => onChange({ ...condition, value: e.target.value.replace(/^#/, '').trim().toLowerCase() })} />,
      );
      break;
    case 'course':
      fields.push(
        <SelectField key="op" label="Match" options={[{ value: 'contains', label: 'name contains' }, { value: 'in', label: 'is exactly' }]} value={condition.operator} onChange={(e) => onChange({ ...condition, operator: e.target.value as 'in' | 'contains' })} />,
        <ValuesField key="value" label="Course" hint="Enrolled in or completed. E.g. python." values={condition.values} onChange={(values) => onChange({ ...condition, values })} />,
      );
      break;
    case 'group':
      fields.push(<ValuesField key="value" label="Group codes" values={condition.values} onChange={(values) => onChange({ ...condition, values })} />);
      break;
    case 'touch':
      fields.push(
        <SelectField key="op" label="Match" options={[{ value: 'did', label: 'did' }, { value: 'did_not', label: 'did not' }]} value={condition.operator} onChange={(e) => onChange({ ...condition, operator: e.target.value as 'did' | 'did_not' })} />,
        <SelectField key="type" label="Action" options={opts(TOUCH_LABEL)} value={condition.touchType} onChange={(e) => onChange({ ...condition, touchType: e.target.value as TouchType })} />,
        <TextField key="days" label="In the last … days" type="number" min={1} value={condition.withinDays ?? ''} hint="Empty: ever." onChange={(e) => onChange({ ...condition, withinDays: days(e.target.value) })} />,
        <TextField key="campaign" label="Campaign or event contains" value={condition.campaignContains ?? ''} hint="Optional, e.g. open_day." onChange={(e) => onChange({ ...condition, campaignContains: e.target.value.trim() || undefined })} />,
      );
      break;
    case 'outcome':
      fields.push(
        <SelectField key="op" label="Match" options={[{ value: 'did', label: 'did' }, { value: 'did_not', label: 'did not' }]} value={condition.operator} onChange={(e) => onChange({ ...condition, operator: e.target.value as 'did' | 'did_not' })} />,
        <SelectField key="type" label="Outcome" options={opts(OUTCOME_LABEL)} value={condition.outcomeType} onChange={(e) => onChange({ ...condition, outcomeType: e.target.value as OutcomeType })} />,
        <TextField key="days" label="In the last … days" type="number" min={1} value={condition.withinDays ?? ''} hint="Empty: ever." onChange={(e) => onChange({ ...condition, withinDays: days(e.target.value) })} />,
      );
      break;
    case 'date':
      fields.push(
        <SelectField key="field" label="Date" options={[{ value: 'firstTouchAt', label: 'First touch' }, { value: 'createdAt', label: 'Added to Audience' }]} value={condition.field} onChange={(e) => onChange({ ...condition, field: e.target.value as 'firstTouchAt' | 'createdAt' })} />,
        <SelectField key="op" label="When" options={[{ value: 'within_days', label: 'within the last' }, { value: 'older_than_days', label: 'more than … ago' }]} value={condition.operator} onChange={(e) => onChange({ ...condition, operator: e.target.value as 'within_days' | 'older_than_days' })} />,
        <TextField key="days" label="Days" type="number" min={1} value={condition.days} onChange={(e) => onChange({ ...condition, days: days(e.target.value) ?? 1 })} />,
      );
      break;
    case 'consent':
      fields.push(
        <SelectField key="topic" label="Topic" options={opts(TOPIC_LABEL)} value={condition.topic} onChange={(e) => onChange({ ...condition, topic: e.target.value as Topic })} />,
        <SelectField key="state" label="State" options={Object.entries(CONSENT).map(([value, item]) => ({ value, label: item.label }))} value={condition.state} onChange={(e) => onChange({ ...condition, state: e.target.value as ConsentState })} />,
        <TextField key="older" label="Since more than … days" type="number" min={1} value={condition.olderThanDays ?? ''} hint="Optional, e.g. 180 for re-engagement." onChange={(e) => onChange({ ...condition, olderThanDays: days(e.target.value) })} />,
      );
      break;
    case 'admissions':
      fields.push(
        <SelectField key="op" label="Match" options={[{ value: 'not_active', label: 'not in an active stage' }, { value: 'active', label: 'in an active stage' }]} value={condition.operator} onChange={(e) => onChange({ ...condition, operator: e.target.value as 'active' | 'not_active' })} />,
      );
      break;
    case 'referred_enrolled':
      fields.push(<p key="note" className="muted">Alumni or students whose referral enrolled (from Alumni Tracker).</p>);
      break;
  }
  return <>{fields}</>;
}

/** Flat rule editor: conditions joined by all/any. Nested groups (up to three levels) work through the API. */
export function SegmentRuleEditor({ rule, onChange }: { rule: SegmentRule; onChange: (rule: SegmentRule) => void }) {
  const conditions = rule.conditions as SegmentCondition[];
  const update = (index: number, next: SegmentCondition) => onChange({ ...rule, conditions: conditions.map((c, i) => (i === index ? next : c)) });
  const remove = (index: number) => onChange({ ...rule, conditions: conditions.filter((_, i) => i !== index) });

  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="How conditions combine">
        <button type="button" className="segmented__btn" aria-pressed={rule.op === 'and'} onClick={() => onChange({ ...rule, op: 'and' })}>
          Match all conditions
        </button>
        <button type="button" className="segmented__btn" aria-pressed={rule.op === 'or'} onClick={() => onChange({ ...rule, op: 'or' })}>
          Match any condition
        </button>
      </div>
      <ol className="list-reset stack">
        {conditions.map((condition, index) => (
          <li key={index} className="inset rule-row">
            <div className="form-row">
              <SelectField
                label={`Condition ${index + 1}`}
                options={opts(KIND_LABEL)}
                value={kindOf(condition)}
                onChange={(e) => update(index, defaultCondition(e.target.value as Kind))}
              />
              <ConditionFields condition={condition} onChange={(next) => update(index, next)} />
            </div>
            <div>
              <Button size="sm" variant="ghost" icon={<Trash size={16} weight="bold" aria-hidden />} disabled={conditions.length === 1} onClick={() => remove(index)}>
                Remove<span className="visually-hidden"> condition {index + 1}</span>
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <div>
        <Button size="sm" variant="secondary" icon={<Plus size={16} weight="bold" aria-hidden />} disabled={conditions.length >= 30} onClick={() => onChange({ ...rule, conditions: [...conditions, defaultCondition('language')] })}>
          Add condition
        </Button>
      </div>
    </div>
  );
}
