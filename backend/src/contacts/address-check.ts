import { Resolver } from 'node:dns/promises';

/**
 * EML-12: does the domain accept mail? An MX record, or (RFC 5321 §5.1 fallback) an A/AAAA record.
 * null = the lookup itself failed (timeout, resolver down): callers accept the address rather than
 * turning a DNS outage into lost sign-ups.
 */
export interface MailDomainChecker {
  acceptsMail(domain: string): Promise<boolean | null>;
}

const NO_RECORDS = new Set(['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN', 'ESERVFAIL']);

export function createMailDomainChecker(timeoutMs = 3000): MailDomainChecker {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 2 });
  const has = async (lookup: () => Promise<unknown[]>): Promise<boolean | null> => {
    try {
      return (await lookup()).length > 0;
    } catch (error) {
      return NO_RECORDS.has((error as { code?: string }).code ?? '') ? false : null;
    }
  };
  return {
    async acceptsMail(domain) {
      const mx = await has(() => resolver.resolveMx(domain));
      if (mx !== false) return mx;
      const a = await has(() => resolver.resolve4(domain));
      if (a !== false) return a;
      return has(() => resolver.resolve6(domain));
    },
  };
}

/**
 * Throwaway-mailbox providers blocked on public forms (EML-12). A short, well-known list on purpose: the
 * cost of a stale entry is one blocked sign-up, so it stays conservative. Extend as abuse is seen.
 */
export const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  'dispostable.com',
  'fakeinbox.com',
  'getnada.com',
  'guerrillamail.com',
  'mailinator.com',
  'maildrop.cc',
  'mintemail.com',
  'sharklasers.com',
  'temp-mail.org',
  'tempmail.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);

export const isDisposable = (email: string) => DISPOSABLE_DOMAINS.has(email.slice(email.lastIndexOf('@') + 1).toLowerCase());
