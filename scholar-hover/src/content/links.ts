import { normalizeSourceUrl } from '../shared/source-page.ts';
import type { PaperSeed } from '../shared/types.ts';

/** Read only the anchor that the reader points at; page text is not metadata. */
export function parseLink(anchor: HTMLAnchorElement): PaperSeed | null {
  if (anchor.hasAttribute('download') || anchor.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return null;
  const href = anchor.getAttribute('href')?.trim();
  if (!href || href.startsWith('#')) return null;
  const url = normalizeSourceUrl(anchor.href);
  if (!url) return null;
  try {
    const current = new URL(location.href); current.hash = '';
    if (url === current.href || url === normalizeSourceUrl(current.href)) return null;
  } catch { return null; }
  const clone = anchor.cloneNode(true) as HTMLAnchorElement;
  clone.querySelectorAll('script,style,noscript,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
  const compact = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim().slice(0, 500);
  const title = compact(clone.textContent) || compact(anchor.getAttribute('aria-label')) || compact(anchor.title) || url.slice(0, 500);
  return { title, authors: [], url, linkOnly: true };
}

export function linkFor(node: EventTarget | null): HTMLAnchorElement | null {
  if (!(node instanceof Element) || node.closest('#scholar-hover-card')) return null;
  const anchor = node.closest<HTMLAnchorElement>('a[href]');
  return anchor && parseLink(anchor) ? anchor : null;
}
