import { escapeHtml } from '../email/render.js';

export type MarkupIssue = { kind: 'link' | 'image'; message: string };

export type LinkTagger = (url: string) => string;

const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const IMAGE = /!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g;
const BOLD = /\*\*([^*]+)\*\*/g;

/** Every link and image URL in the body, for pre-send checks (NWS-09 / Flow B step 3). */
export function extractUrls(body: string): { links: string[]; images: { url: string; alt: string }[] } {
  return {
    links: [...body.matchAll(LINK)].map((match) => match[2] as string).filter((_, i, all) => all.indexOf(_) === i),
    images: [...body.matchAll(IMAGE)].map((match) => ({ alt: (match[1] as string).trim(), url: match[2] as string })),
  };
}

/**
 * Adds campaign parameters (9.3: medium email) and the contact token to a link, keeping existing
 * parameters. Links to other pages of the email system itself are left alone.
 */
export function tagUrl(url: string, params: { source: string; campaign: string; token?: string; content?: string }): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('utm_source')) parsed.searchParams.set('utm_source', params.source);
    if (!parsed.searchParams.has('utm_medium')) parsed.searchParams.set('utm_medium', 'email');
    if (!parsed.searchParams.has('utm_campaign')) parsed.searchParams.set('utm_campaign', params.campaign);
    // NWS-14: which newsletter block the click came from.
    if (params.content && !parsed.searchParams.has('utm_content')) parsed.searchParams.set('utm_content', params.content);
    if (params.token) parsed.searchParams.set('mh', params.token);
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Small, safe markup for email bodies (NFR-S7): text is escaped first, then only these forms become HTML:
 * blank-line paragraphs, **bold**, [text](https://link), ![alt](https://image). Nothing else passes through.
 */
export function renderMarkup(body: string, tag: LinkTagger): { html: string; text: string } {
  const paragraphs = body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const html = paragraphs
    .map((paragraph) => {
      const images: string[] = [];
      let safe = escapeHtml(paragraph).replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, (_m, alt: string, url: string) => {
        images.push(`<img src="${url}" alt="${alt}" width="536" style="display:block;max-width:100%;height:auto;border-radius:12px;margin:0 0 16px;">`);
        return `\u0000${images.length - 1}\u0000`;
      });
      safe = safe
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => {
          const tagged = escapeHtml(tag(unescape(url)));
          return `<a href="${tagged}" style="color:#B000A6;font-weight:700;">${text}</a>`;
        })
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
      const withImages = safe.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => images[Number(i)] as string);
      return withImages.startsWith('<img') && withImages.endsWith('>') ? withImages : `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${withImages}</p>`;
    })
    .join('\n');

  const text = paragraphs
    .map((paragraph) =>
      paragraph
        .replace(IMAGE, (_m, alt: string) => (alt ? `[${alt}]` : ''))
        .replace(LINK, (_m, label: string, url: string) => `${label} (${tag(url)})`)
        .replace(BOLD, '$1'),
    )
    .join('\n\n');
  return { html, text };
}

/** Undo escapeHtml for a URL captured from escaped text, before tagging and escaping it again. */
function unescape(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
