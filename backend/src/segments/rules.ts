import { and, gte, ilike, inArray, isNull, lte, ne, not, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { CONSENT_STATES, TOPICS } from '../consent/wordings.js';
import { CHANNEL_IDS, CONTACT_TYPES, LANGUAGES } from '../contacts/fields.js';
import { consentRecords, contacts, outcomes, touchpoints } from '../db/schema.js';
import { ACTIVE_ADMISSION_STAGES } from '../sync/service.js';
import { TOUCHPOINT_TYPES } from '../touchpoints/repository.js';

const DAY = 86_400_000;
const days = z.number().int().min(1).max(3650);
const text = z.string().trim().min(1).max(100);

const OUTCOME_TYPES = ['lead', 'applied', 'enrolled', 'completed', 'hired'] as const;

/** Attribute values are checked against their allowed lists; free-text fields only accept short strings. */
const attribute = z.discriminatedUnion('field', [
  z.object({ kind: z.literal('attribute'), field: z.literal('type'), operator: z.enum(['in', 'not_in']), values: z.array(z.enum(CONTACT_TYPES)).min(1) }),
  z.object({ kind: z.literal('attribute'), field: z.literal('language'), operator: z.enum(['in', 'not_in']), values: z.array(z.enum(LANGUAGES)).min(1) }),
  z.object({ kind: z.literal('attribute'), field: z.literal('sourceChannel'), operator: z.enum(['in', 'not_in']), values: z.array(z.enum(CHANNEL_IDS)).min(1) }),
  z.object({ kind: z.literal('attribute'), field: z.literal('sourceCampaign'), operator: z.enum(['in', 'not_in']), values: z.array(text).min(1).max(50) }),
  z.object({ kind: z.literal('attribute'), field: z.literal('employmentStatus'), operator: z.enum(['in', 'not_in']), values: z.array(z.enum(['employed', 'seeking', 'not_seeking'])).min(1) }),
]);

const condition = z.union([
  attribute,
  z.object({ kind: z.literal('tag'), operator: z.enum(['has', 'has_not']), value: text }),
  z.object({ kind: z.literal('course'), operator: z.enum(['in', 'contains']), values: z.array(text).min(1).max(50) }),
  z.object({ kind: z.literal('group'), operator: z.literal('in'), values: z.array(text).min(1).max(50) }),
  z.object({
    kind: z.literal('touch'),
    touchType: z.enum(TOUCHPOINT_TYPES),
    operator: z.enum(['did', 'did_not']),
    withinDays: days.optional(),
    channel: z.enum(CHANNEL_IDS).optional(),
    campaignContains: text.optional(),
  }),
  z.object({ kind: z.literal('outcome'), outcomeType: z.enum(OUTCOME_TYPES), operator: z.enum(['did', 'did_not']), withinDays: days.optional() }),
  z.object({ kind: z.literal('date'), field: z.enum(['firstTouchAt', 'createdAt']), operator: z.enum(['within_days', 'older_than_days']), days }),
  z.object({ kind: z.literal('consent'), topic: z.enum(TOPICS), state: z.enum(CONSENT_STATES), olderThanDays: days.optional() }),
  z.object({ kind: z.literal('admissions'), operator: z.enum(['active', 'not_active']) }),
  z.object({ kind: z.literal('referred_enrolled') }),
]);

export type Condition = z.infer<typeof condition>;
export type RuleGroup = { op: 'and' | 'or'; conditions: (Condition | RuleGroup)[] };

/** Up to three levels and 30 conditions: enough for 6.4, small enough to stay fast (NFR-F2). */
const group: z.ZodType<RuleGroup> = z.lazy(() =>
  z.object({ op: z.enum(['and', 'or']), conditions: z.array(z.union([condition, group])).min(1).max(30) }).strict(),
);

export const ruleSchema = group.superRefine((rule, context) => {
  const depth = (node: RuleGroup, level: number): number =>
    Math.max(level, ...node.conditions.map((child) => ('op' in child ? depth(child, level + 1) : level)));
  if (depth(rule, 1) > 3) context.addIssue({ code: 'custom', message: 'Rules can be nested at most three levels deep' });
});

const ago = (now: Date, count: number) => new Date(now.getTime() - count * DAY);

const latestConsent = (topic: string) =>
  sql`(select ${consentRecords.state} from ${consentRecords} where ${consentRecords.contactId} = ${contacts.id} and ${consentRecords.topic} = ${topic} order by ${consentRecords.createdAt} desc limit 1)`;

const latestConsentAt = (topic: string) =>
  sql`(select ${consentRecords.createdAt} from ${consentRecords} where ${consentRecords.contactId} = ${contacts.id} and ${consentRecords.topic} = ${topic} order by ${consentRecords.createdAt} desc limit 1)`;

function compileCondition(c: Condition, now: Date): SQL {
  switch (c.kind) {
    case 'attribute': {
      const column = { type: contacts.type, language: contacts.language, sourceChannel: contacts.sourceChannel, sourceCampaign: contacts.sourceCampaign, employmentStatus: contacts.employmentStatus }[c.field];
      const values = c.values as string[];
      // "not in" keeps contacts with no value: an unknown source is not one of the excluded sources.
      return c.operator === 'in' ? inArray(column, values) : (or(isNull(column), notInArray(column, values)) as SQL);
    }
    case 'tag': {
      const has = sql`${c.value} = any(${contacts.tags})`;
      return c.operator === 'has' ? has : not(has);
    }
    case 'course':
    case 'group': {
      const column = c.kind === 'course' ? outcomes.courseId : outcomes.groupId;
      const match = c.kind === 'course' && c.operator === 'contains' ? (or(...c.values.map((value) => ilike(column, `%${escapeLike(value)}%`))) as SQL) : inArray(column, c.values);
      return sql`exists (select 1 from ${outcomes} where ${outcomes.contactId} = ${contacts.id} and ${outcomes.type} in ('enrolled', 'completed') and ${match})`;
    }
    case 'touch': {
      const filters = [
        sql`${touchpoints.contactId} = ${contacts.id}`,
        sql`${touchpoints.type} = ${c.touchType}`,
        c.withinDays ? gte(touchpoints.occurredAt, ago(now, c.withinDays)) : undefined,
        c.channel ? sql`${touchpoints.channel} = ${c.channel}` : undefined,
        c.campaignContains ? ilike(touchpoints.campaign, `%${escapeLike(c.campaignContains)}%`) : undefined,
      ].filter(Boolean) as SQL[];
      const exists = sql`exists (select 1 from ${touchpoints} where ${and(...filters)})`;
      return c.operator === 'did' ? exists : not(exists);
    }
    case 'outcome': {
      const filters = [
        sql`${outcomes.contactId} = ${contacts.id}`,
        sql`${outcomes.type} = ${c.outcomeType}`,
        c.withinDays ? gte(outcomes.occurredAt, ago(now, c.withinDays)) : undefined,
      ].filter(Boolean) as SQL[];
      const exists = sql`exists (select 1 from ${outcomes} where ${and(...filters)})`;
      return c.operator === 'did' ? exists : not(exists);
    }
    case 'date': {
      const column = c.field === 'firstTouchAt' ? contacts.firstTouchAt : contacts.createdAt;
      return c.operator === 'within_days' ? gte(column, ago(now, c.days)) : lte(column, ago(now, c.days));
    }
    case 'consent': {
      const state = sql`coalesce(${latestConsent(c.topic)}, 'unknown') = ${c.state}`;
      return c.olderThanDays ? (and(state, sql`${latestConsentAt(c.topic)} <= ${ago(now, c.olderThanDays)}`) as SQL) : state;
    }
    case 'admissions': {
      const active = inArray(contacts.crmStage, ACTIVE_ADMISSION_STAGES);
      return c.operator === 'active' ? active : (or(isNull(contacts.crmStage), not(active)) as SQL);
    }
    case 'referred_enrolled': {
      // A referral touch on this contact whose referred email belongs to a contact who enrolled (6.4).
      return sql`exists (select 1 from ${touchpoints} t join ${contacts} referred on referred.email = t.source_ref join ${outcomes} o on o.contact_id = referred.id and o.type = 'enrolled' where t.contact_id = ${contacts.id} and t.type = 'referral')`;
    }
  }
}

/** The rule as a WHERE clause on contacts; erased records never match. */
export function compileRule(rule: RuleGroup, now: Date): SQL {
  const compileGroup = (node: RuleGroup): SQL => {
    const parts = node.conditions.map((child) => ('op' in child ? compileGroup(child) : compileCondition(child, now)));
    return (node.op === 'and' ? and(...parts) : or(...parts)) as SQL;
  };
  return and(ne(contacts.status, 'erased'), compileGroup(rule)) as SQL;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
