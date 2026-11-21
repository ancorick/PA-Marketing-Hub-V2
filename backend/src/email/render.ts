import type { Language } from '../integrations/core-engine/contract.js';

/** HTML-escapes text placed into templates (NFR-S7: no script injection through names or copy). */
export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

export type EmailFooter = {
  /** Why the person receives this email (NFR-P3). */
  reason: string;
  postalAddress: string;
  /** Required for marketing email (EML-11, AUD-09); transactional email has none. */
  unsubscribeUrl?: string;
  preferencesUrl?: string;
};

/** Template look (NWS-15). Colours are validated hex values; the font stack always ends in safe fallbacks. */
export type EmailTheme = {
  accentColor: string;
  buttonTextColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  logoUrl: string | null;
  headerText: string;
  footerNote?: string | null;
};

export const DEFAULT_THEME: EmailTheme = {
  accentColor: '#FFDC00',
  buttonTextColor: '#131317',
  backgroundColor: '#F6F5FA',
  textColor: '#121216',
  fontFamily: "'Manrope', 'Noto Sans Armenian', Arial, Helvetica, sans-serif",
  logoUrl: null,
  headerText: 'Picsart Academy',
};

export type EmailContent = {
  theme?: EmailTheme;
  language: Language;
  /** Inbox preview line. */
  preheader?: string;
  title: string;
  /** Plain paragraphs; escaped. */
  paragraphs?: string[];
  /** Already-safe HTML blocks (e.g. sanitized newsletter blocks) with their plain-text versions. */
  blocks?: { html: string; text: string }[];
  button?: { label: string; url: string };
  footer: EmailFooter;
};

const FOOTER_LABELS: Record<Language, { unsubscribe: string; preferences: string; sender: string }> = {
  en: { unsubscribe: 'Unsubscribe', preferences: 'Email preferences', sender: 'Sent by Picsart Academy' },
  hy: { unsubscribe: 'Ապաբաժանորդագրվել', preferences: 'Նամակների կարգավորումներ', sender: 'Ուղարկող՝ Picsart Academy' },
  ru: { unsubscribe: 'Отписаться', preferences: 'Настройки рассылки', sender: 'Отправитель: Picsart Academy' },
};

/**
 * Renders an email as HTML and plain text (EML-11). Table layout and inline styles for mail clients; a dark
 * mode hint for clients that support it; the footer always names the sender, the reason, the physical
 * address and, for marketing, the unsubscribe and preferences links (NFR-P3).
 */
export function renderEmail(content: EmailContent): { html: string; text: string } {
  const labels = FOOTER_LABELS[content.language];
  const theme = content.theme ?? DEFAULT_THEME;
  const color = (value: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback);
  const accent = color(theme.accentColor, DEFAULT_THEME.accentColor);
  const buttonText = color(theme.buttonTextColor, DEFAULT_THEME.buttonTextColor);
  const background = color(theme.backgroundColor, DEFAULT_THEME.backgroundColor);
  const textColor = color(theme.textColor, DEFAULT_THEME.textColor);
  const font = escapeHtml(theme.fontFamily.replace(/[;{}<>]/g, ''));
  const paragraphs = content.paragraphs ?? [];
  const blocksHtml = [
    ...paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${escapeHtml(p)}</p>`),
    ...(content.blocks ?? []).map((block) => block.html),
  ].join('\n');
  const button = content.button
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:${accent};color:${buttonText};font-weight:700;text-decoration:none;">${escapeHtml(content.button.label)}</a></p>`
    : '';
  const footerLinks = [
    content.footer.unsubscribeUrl && `<a href="${escapeHtml(content.footer.unsubscribeUrl)}" style="color:#555;">${labels.unsubscribe}</a>`,
    content.footer.preferencesUrl && `<a href="${escapeHtml(content.footer.preferencesUrl)}" style="color:#555;">${labels.preferences}</a>`,
  ]
    .filter(Boolean)
    .join(' · ');

  const html = `<!doctype html>
<html lang="${content.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(content.title)}</title>
</head>
<body style="margin:0;padding:0;background:${background};font-family:${font};color:${textColor};">
${content.preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(content.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${background};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:24px;">
<tr><td style="padding:32px 32px 8px;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#43465A;">${theme.logoUrl ? `<img src="${escapeHtml(theme.logoUrl)}" alt="${escapeHtml(theme.headerText)}" height="40" style="display:block;height:40px;width:auto;">` : escapeHtml(theme.headerText)}</td></tr>
<tr><td style="padding:8px 32px 24px;">
<h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;">${escapeHtml(content.title)}</h1>
${blocksHtml}
${button}
</td></tr>
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="padding:16px 32px;font-size:12px;line-height:1.6;color:#555;">
<p style="margin:0 0 8px;">${labels.sender}. ${escapeHtml(content.footer.reason)}</p>
${theme.footerNote ? `<p style="margin:0 0 8px;">${escapeHtml(theme.footerNote)}</p>` : ''}
<p style="margin:0 0 8px;">${escapeHtml(content.footer.postalAddress)}</p>
${footerLinks ? `<p style="margin:0;">${footerLinks}</p>` : ''}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    content.title,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(content.blocks ?? []).flatMap((block) => [block.text, '']),
    ...(content.button ? [`${content.button.label}: ${content.button.url}`, ''] : []),
    '--',
    `${labels.sender}. ${content.footer.reason}`,
    ...(theme.footerNote ? [theme.footerNote] : []),
    content.footer.postalAddress,
    ...(content.footer.unsubscribeUrl ? [`${labels.unsubscribe}: ${content.footer.unsubscribeUrl}`] : []),
    ...(content.footer.preferencesUrl ? [`${labels.preferences}: ${content.footer.preferencesUrl}`] : []),
  ].join('\n');

  return { html, text };
}
