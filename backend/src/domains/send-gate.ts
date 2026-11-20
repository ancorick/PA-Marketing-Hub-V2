import type { EmailAdapter } from '../email/index.js';
import { fromDomain, type SendVerdict } from './service.js';

export type BlockKind = 'not_verified' | 'daily_cap' | 'kill_switch';

export class SendBlockedError extends Error {
  readonly code = 'domain_not_verified';

  constructor(
    reason: string,
    readonly kind: BlockKind = 'not_verified',
  ) {
    super(`Marketing send blocked: ${reason}`);
    this.name = 'SendBlockedError';
  }
}

type MarketingSendPolicy = { authorizeMarketingSend(domain: string): Promise<SendVerdict> };

/** EML-14: true while the kill switch is on. */
export type PauseCheck = () => Promise<boolean>;

/**
 * EML-03: wraps the ESP adapter so no marketing email leaves from a domain that does not pass
 * SPF, DKIM and DMARC, and (EML-08) none goes past the domain's warm-up cap for the day. Every sending path (campaigns, newsletter, test sends) goes through it.
 * Transactional mail is not governed by Marketing Hub (PRD 3.4) and passes through unchanged.
 */
export function guardMarketingSends(adapter: EmailAdapter, policy: MarketingSendPolicy, isPaused?: PauseCheck): EmailAdapter {
  return {
    name: adapter.name,
    registerDomain: (domain) => adapter.registerDomain(domain),
    deregisterDomain: (domain) => adapter.deregisterDomain(domain),
    async send(message) {
      if (message.stream === 'marketing') {
        if (await isPaused?.()) throw new SendBlockedError('all marketing sending is paused (kill switch)', 'kill_switch');
        const domain = fromDomain(message.from);
        if (!domain) throw new SendBlockedError(`"${message.from}" has no sender domain`);
        const verdict = await policy.authorizeMarketingSend(domain);
        if (!verdict.allowed) throw new SendBlockedError(verdict.reason, verdict.kind);
      }
      return adapter.send(message);
    },
  };
}
