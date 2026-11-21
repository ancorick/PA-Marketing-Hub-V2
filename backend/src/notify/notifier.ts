import type { EmailAdapter } from '../email/adapter.js';
import { renderEmail } from '../email/render.js';

export type Notice = { title: string; text: string; link: string };
/** Who gets the email copy; the newsletter editors by default. */
export type Audience = { to: string[]; reason: string };

type Deps = {
  slackWebhookUrl: string | null;
  editorEmails: string[];
  email: EmailAdapter;
  mail: { from: string; postalAddress: string };
  logger: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  fetcher?: typeof fetch;
};

/**
 * Staff notifications (NWS-04, ANL-11): a Slack incoming webhook and an email to the newsletter editors or admins. Without a
 * webhook URL the Slack message is logged; a failure in one channel never blocks the other or the draft.
 */
export class Notifier {
  constructor(private readonly deps: Deps) {}

  async notify(notice: Notice, audience: Audience = { to: this.deps.editorEmails, reason: 'You receive this because you edit the Academy newsletter.' }): Promise<void> {
    const fetcher = this.deps.fetcher ?? fetch;
    if (this.deps.slackWebhookUrl) {
      try {
        const response = await fetcher(this.deps.slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `*${notice.title}*\n${notice.text}\n<${notice.link}|Open in Marketing Hub>` }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Slack answered ${response.status}`);
      } catch (error) {
        this.deps.logger.error({ err: error }, 'Slack notification failed');
      }
    } else {
      this.deps.logger.info({ notice }, 'Slack notification (SLACK_WEBHOOK_URL not set)');
    }
    for (const to of audience.to) {
      try {
        const { html, text } = renderEmail({
          language: 'en',
          title: notice.title,
          paragraphs: [notice.text],
          button: { label: 'Open in Marketing Hub', url: notice.link },
          footer: { reason: audience.reason, postalAddress: this.deps.mail.postalAddress },
        });
        await this.deps.email.send({
          idempotencyKey: `notice:${notice.link}:${to}:${Date.now()}`,
          stream: 'transactional',
          from: this.deps.mail.from,
          to,
          subject: notice.title,
          html,
          text,
          tags: { type: 'staff_notice' },
        });
      } catch (error) {
        this.deps.logger.error({ err: error, to }, 'staff email notification failed');
      }
    }
  }
}
