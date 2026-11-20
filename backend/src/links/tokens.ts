import { createHmac, timingSafeEqual } from 'node:crypto';

/** What a signed link lets its holder do (NFR-S5). */
export type LinkPurpose = 'unsubscribe' | 'preferences' | 'confirm' | 'track';

export type LinkClaims = { contactId: string; purpose: LinkPurpose; expiresAt: Date };

/** Unsubscribe and preferences links must keep working long after the email (a year); confirmations are short. */
/** track: the contact token in tagged links (9.2 identity resolution), long-lived like the email itself. */
export const LINK_LIFETIME_DAYS: Record<LinkPurpose, number> = { unsubscribe: 365, preferences: 365, confirm: 7, track: 730 };

export class InvalidLinkError extends Error {
  constructor(readonly expired: boolean) {
    super(expired ? 'This link has expired' : 'This link is not valid');
    this.name = 'InvalidLinkError';
  }
}

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/**
 * Signed, expiring link tokens: base64url(JSON {c, p, e}) + "." + HMAC-SHA256. The payload holds only the
 * contact's random ID, the purpose and the expiry, so the URL reveals no personal data.
 */
export class LinkSigner {
  constructor(
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  sign(contactId: string, purpose: LinkPurpose): string {
    const expires = Math.floor(this.now().getTime() / 1000) + LINK_LIFETIME_DAYS[purpose] * 86_400;
    const payload = b64(JSON.stringify({ c: contactId, p: purpose, e: expires }));
    return `${payload}.${this.mac(payload)}`;
  }

  /** Throws InvalidLinkError for a forged, malformed, wrong-purpose or expired token. */
  verify(token: string, purpose: LinkPurpose): LinkClaims {
    const [payload, mac, extra] = token.split('.');
    if (!payload || !mac || extra !== undefined) throw new InvalidLinkError(false);
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new InvalidLinkError(false);
    let claims: { c?: unknown; p?: unknown; e?: unknown };
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new InvalidLinkError(false);
    }
    if (typeof claims.c !== 'string' || claims.p !== purpose || typeof claims.e !== 'number') throw new InvalidLinkError(false);
    const expiresAt = new Date(claims.e * 1000);
    if (expiresAt <= this.now()) throw new InvalidLinkError(true);
    return { contactId: claims.c, purpose, expiresAt };
  }

  private mac(payload: string) {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

/** Public URLs for one contact, used in every marketing email footer and header (AUD-09, AUD-10, AUD-11). */
export class ContactLinks {
  constructor(
    private readonly signer: LinkSigner,
    private readonly urls: { app: string; api: string },
  ) {}

  /** Footer link: the confirmation page that unsubscribes in one click and offers undo (Flow E). */
  unsubscribePage(contactId: string) {
    return `${this.urls.app}/#/p/unsubscribe?t=${this.signer.sign(contactId, 'unsubscribe')}`;
  }

  preferencesPage(contactId: string) {
    return `${this.urls.app}/#/p/preferences?t=${this.signer.sign(contactId, 'preferences')}`;
  }

  confirmPage(contactId: string) {
    return `${this.urls.app}/#/p/confirm?t=${this.signer.sign(contactId, 'confirm')}`;
  }

  /**
   * RFC 2369 / RFC 8058 headers: mail clients show a native unsubscribe button and POST
   * "List-Unsubscribe=One-Click" to the HTTPS URL, with no page to load (AUD-10).
   */
  unsubscribeHeaders(contactId: string): Record<string, string> {
    const url = `${this.urls.api}/api/public/unsubscribe?t=${this.signer.sign(contactId, 'unsubscribe')}`;
    return { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  }
}
