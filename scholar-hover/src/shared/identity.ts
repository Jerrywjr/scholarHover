import type { PaperSeed } from './types';
import { normalizeSourceUrl } from './source-page';

function text(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function normalizedUrl(value: string): string {
  try {
    // URL normalizes host casing and default ports. Preserve path case, query
    // values and fragments, which can distinguish paper versions.
    return new URL(value.trim()).href;
  } catch {
    return value.trim();
  }
}

/** Only URL-only previews share link labels; explicit arXiv revisions remain separate. */
export function linkPreviewKey(url: string): string {
  return JSON.stringify(['link-preview-v1', normalizeSourceUrl(url) ?? normalizedUrl(url)]);
}

/** A seed identity, not a title-only match: different destinations stay distinct. */
export function previewKey(seed: PaperSeed): string {
  if (seed.linkOnly) return linkPreviewKey(seed.url);
  return JSON.stringify([
    'preview-v1',
    text(seed.title),
    seed.authors.map(text),
    seed.year ?? null,
    normalizedUrl(seed.url),
    text(seed.doi ?? '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, '').replace(/^doi:\s*/u, ''),
    seed.preprint ?? null,
  ]);
}
