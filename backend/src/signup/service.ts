import type { ConsentService } from '../consent/service.js';
import { findWording, type Topic } from '../consent/wordings.js';
import { isDisposable, type MailDomainChecker } from '../contacts/address-check.js';
import { channelFromUtm } from '../contacts/channels.js';
import { ContactFieldError, normalizeCampaign, normalizeEmail, normalizeName } from '../contacts/fields.js';
import { DuplicateContactError, type Contact, type ContactRepository } from '../contacts/repository.js';
import type { ContactService } from '../contacts/service.js';
import type { EmailAdapter } from '../email/adapter.js';
import { renderEmail } from '../email/render.js';
import type { Language } from '../integrations/core-engine/contract.js';
import type { NavigatorCrmClient } from '../integrations/navigator-crm/contract.js';
import type { ContactLinks, LinkSigner } from '../links/tokens.js';
import type { TouchpointRepository } from '../touchpoints/repository.js';

export type SignupInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  language: Language;
  /** Each ticked consent box with the version of the wording shown next to it (6.3 rule 4). */
  consent: { topic: Topic; wordingVersion: string }[];
  /** Page the form was on, with its campaign parameters (AUD-20). */
  pageUrl?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  /** "I want to apply" / course of interest: creates a lead in Navigator CRM (11.1, Flow A step 6). */
  courseInterest?: string | null;
  wantsToApply?: boolean;
  /** website = Academy site forms; social_lead_form = lead ads forwarded by the site or an integration. */
  form: 'website' | 'social_lead_form';
};

const SYSTEM_ACTOR = 'website-form';

const CONFIRM_EMAIL: Record<Language, { subject: string; title: string; text: string; button: string; reason: string }> = {
  en: {
    subject: 'Confirm your Picsart Academy subscription',
    title: 'One click to confirm',
    text: 'You asked to receive emails from Picsart Academy. Confirm your address so we know it was you. If it was not, ignore this email and nothing will be sent.',
    button: 'Confirm subscription',
    reason: 'You receive this email because this address was entered in a sign-up form on our website.',
  },
  hy: {
    subject: 'Հաստատեք ձեր բաժանորդագրությունը Picsart Academy-ին',
    title: 'Մեկ սեղմում՝ հաստատելու համար',
    text: 'Դուք խնդրել եք ստանալ Picsart Academy-ի նամակները։ Հաստատեք ձեր հասցեն, որպեսզի համոզվենք, որ դա դուք եք։ Եթե դա դուք չեք, անտեսեք այս նամակը, և ոչինչ չի ուղարկվի։',
    button: 'Հաստատել բաժանորդագրությունը',
    reason: 'Ստանում եք այս նամակը, քանի որ այս հասցեն մուտքագրվել է մեր կայքի բաժանորդագրման ձևում։',
  },
  ru: {
    subject: 'Подтвердите подписку на Picsart Academy',
    title: 'Подтвердите одним нажатием',
    text: 'Вы попросили присылать вам письма Picsart Academy. Подтвердите адрес, чтобы мы знали, что это вы. Если это были не вы, просто проигнорируйте письмо — ничего не придёт.',
    button: 'Подтвердить подписку',
    reason: 'Вы получили это письмо, потому что этот адрес указали в форме подписки на нашем сайте.',
  },
};

type SignupServiceDeps = {
  contacts: ContactService;
  contactRepository: Pick<ContactRepository, 'findByEmail' | 'findById' | 'update'>;
  consent: ConsentService;
  touchpoints: TouchpointRepository;
  email: EmailAdapter;
  links: ContactLinks;
  signer: LinkSigner;
  crm: Pick<NavigatorCrmClient, 'createLead'>;
  mailChecker: MailDomainChecker;
  mail: { from: string; postalAddress: string };
  logger: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  now?: () => Date;
};

/**
 * Sign-ups from website forms and social lead forms (AUD-20, Flow A) with double opt-in (AUD-08):
 * consent is pending until the person clicks the link in the confirmation email.
 */
export class SignupService {
  private readonly now: () => Date;

  constructor(private readonly deps: SignupServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async signUp(input: SignupInput, request: { ip: string }): Promise<void> {
    const email = normalizeEmail(input.email);
    await this.checkAddress(email);
    if (input.consent.length === 0) throw new ContactFieldError('consent', 'Tick at least one box to receive emails');
    for (const { topic, wordingVersion } of input.consent) {
      const wording = findWording(wordingVersion);
      if (!wording || wording.topic !== topic) throw new ContactFieldError('consent', `Unknown consent wording ${wordingVersion} for ${topic}`);
    }

    const channel = channelFromUtm(input.utmSource, input.utmMedium);
    const campaign = safeCampaign(input.utmCampaign);
    const contact = await this.findOrCreate(email, input, channel, campaign);

    // Pending only for topics not already granted; nothing to confirm means no email.
    const current = await this.deps.consent.current(contact.id);
    const pending = input.consent.filter(({ topic }) => current[topic] !== 'granted');
    for (const { topic, wordingVersion } of pending) {
      await this.deps.consent.record(
        contact.id,
        { topics: [topic], state: 'pending', method: 'form', wordingVersion, sourceUrl: input.pageUrl ?? null, ip: request.ip },
        { kind: 'person' },
      );
    }
    if (pending.length > 0) await this.sendConfirmation(contact, input.language);

    await this.deps.touchpoints.record({
      contactId: contact.id,
      channel,
      campaign,
      type: 'form',
      occurredAt: this.now(),
      sourceSystem: input.form === 'social_lead_form' ? 'social_lead_form' : 'website',
      sourceRef: input.pageUrl ?? null,
    });

    if (input.wantsToApply || input.courseInterest) {
      try {
        await this.deps.crm.createLead({
          email,
          firstName: normalizeName(input.firstName) ?? '',
          lastName: normalizeName(input.lastName) ?? '',
          ...(input.courseInterest && { courseInterest: input.courseInterest }),
          channel,
          ...(campaign && { campaign }),
        });
      } catch (error) {
        // The sign-up itself succeeded; the CRM sync (AUD-06) can create the lead later.
        this.deps.logger.error({ err: error, contactId: contact.id }, 'Navigator CRM lead creation failed');
      }
    }
  }

  /** The confirmation click (AUD-08): every pending topic becomes granted, as the person's own action. */
  async confirm(token: string): Promise<{ language: Language }> {
    const { contactId } = this.deps.signer.verify(token, 'confirm');
    const contact = await this.deps.contactRepository.findById(contactId);
    if (!contact || contact.status === 'erased') throw new ContactFieldError('token', 'This link no longer works');
    const view = await this.deps.consent.view(contactId);
    for (const topic of view?.topics.filter((t) => t.state === 'pending') ?? []) {
      await this.deps.consent.record(
        contactId,
        { topics: [topic.topic], state: 'granted', method: 'form', wordingVersion: topic.wordingVersion, sourceUrl: 'confirmation link' },
        { kind: 'person' },
      );
    }
    return { language: contact.language };
  }

  /** EML-12: syntax (normalizeEmail), no throwaway providers, and a domain that accepts mail. */
  private async checkAddress(email: string) {
    if (isDisposable(email)) throw new ContactFieldError('email', 'Please use a permanent email address');
    const accepts = await this.deps.mailChecker.acceptsMail(email.slice(email.lastIndexOf('@') + 1));
    if (accepts === false) throw new ContactFieldError('email', 'This email domain cannot receive mail; check the address');
  }

  private async findOrCreate(email: string, input: SignupInput, channel: string, campaign: string | null): Promise<Contact> {
    const existing = await this.deps.contactRepository.findByEmail(email);
    if (existing) {
      // Never overwrite what is known (first touch, source); only fill empty names.
      const changes = {
        ...(!existing.firstName && normalizeName(input.firstName) && { firstName: normalizeName(input.firstName) }),
        ...(!existing.lastName && normalizeName(input.lastName) && { lastName: normalizeName(input.lastName) }),
      };
      return Object.keys(changes).length > 0 ? ((await this.deps.contactRepository.update(existing.id, changes, SYSTEM_ACTOR)) ?? existing) : existing;
    }
    try {
      const created = await this.deps.contacts.create(
        {
          email,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          language: input.language,
          sourceChannel: channel as never,
          sourceCampaign: campaign,
        },
        { userId: SYSTEM_ACTOR },
      );
      return (await this.deps.contactRepository.findById(created.id)) as Contact;
    } catch (error) {
      // Two submissions at once: the second finds the first one's record.
      if (error instanceof DuplicateContactError && error.existingId) {
        return (await this.deps.contactRepository.findById(error.existingId)) as Contact;
      }
      throw error;
    }
  }

  private async sendConfirmation(contact: Contact, language: Language) {
    const copy = CONFIRM_EMAIL[language];
    const { html, text } = renderEmail({
      language,
      title: copy.title,
      paragraphs: [copy.text],
      button: { label: copy.button, url: this.deps.links.confirmPage(contact.id) },
      footer: { reason: copy.reason, postalAddress: this.deps.mail.postalAddress },
    });
    // Transactional: it carries no marketing content (6.3 rule 6) and must arrive even during warm-up.
    await this.deps.email.send({
      idempotencyKey: `confirm:${contact.id}:${this.now().getTime()}`,
      stream: 'transactional',
      from: this.deps.mail.from,
      to: contact.email as string,
      subject: copy.subject,
      html,
      text,
      tags: { type: 'double_opt_in' },
    });
  }
}

/** utm_campaign as a campaign code; anything unusable is dropped rather than failing a sign-up. */
function safeCampaign(value: string | null | undefined): string | null {
  try {
    return normalizeCampaign(value?.replace(/\s+/g, '_').slice(0, 100));
  } catch {
    return null;
  }
}
