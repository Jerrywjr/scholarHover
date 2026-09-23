import type { Paper, PaperSeed } from './types';
import { authorsOverlap, normalizeDoi, normalizeTitle } from './matching';

const MAX_HTML_LENGTH = 2_000_000;
const MAX_ABSTRACT_LENGTH = 100_000;
const ARXIV_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']);
const ARXIV_ID = /^(\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z][a-z-]*(?:\.[a-z]{2})?\/\d{2}(?:0[1-9]|1[0-2])\d{3})(v[1-9]\d*)?$/i;
const SENSITIVE_PATH = /(?:^|\/)(?:api|v\d+|graphql|login|logout|signin|signout|oauth2?|auth|admin|account|settings|credentials|tokens?)(?:\/|$)/i;
const SECRET_QUERY = /^(?:access[_-]?token|api[_-]?key|authorization|password|secret|token)$/i;

interface ArxivIdentity { id: string; base: string; version?: string }
function arxivIdentity(value: string | undefined): ArxivIdentity | undefined {
  if (!value) return undefined;
  const id = value.trim().replace(/^arxiv:/i, '').replace(/\.pdf$/i, '');
  const match = ARXIV_ID.exec(id);
  return match ? { id, base: match[1], version: match[2]?.toLowerCase() } : undefined;
}

/** URL checks precede host permission checks and fetching. They do not resolve DNS. */
function publicUrl(value: string): URL | undefined {
  try {
    if (value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value.trim())) return undefined;
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    // Scholarly sources are named hosts. Reject all IP literals, including URL's
    // normalized decimal/hex IPv4 forms and IPv4-mapped IPv6, rather than guess.
    if (!host.includes('.') || host.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|lan|home|test)$/.test(host)
      || /^scholar\.google\./.test(host) || /(?:^|\.)api[.-]/.test(host)
      || /(?:^|\.)(?:openai\.com|openalex\.org)$/.test(host)) return undefined;
    const pathname = decodeURIComponent(url.pathname);
    if (SENSITIVE_PATH.test(pathname) || [...url.searchParams.keys()].some(key => SECRET_QUERY.test(key))) return undefined;
    url.hostname = host;
    return url;
  } catch { return undefined; }
}

/** Normalize only supported arXiv article routes; publisher query strings survive. */
export function normalizeSourceUrl(value: string): string | undefined {
  const url = publicUrl(value.replace(/^http:\/\/((?:(?:www|export)\.)?arxiv\.org)\//i, 'https://$1/'));
  if (!url) return undefined;
  if (ARXIV_HOSTS.has(url.hostname)) {
    const match = /^\/(?:abs|pdf|html)\/(.+)$/.exec(url.pathname);
    const identity = arxivIdentity(match?.[1]);
    return identity ? `https://arxiv.org/abs/${identity.id}` : undefined;
  }
  if (['doi.org', 'dx.doi.org'].includes(url.hostname) && /^\/10\.48550\/arxiv\./i.test(url.pathname)) {
    const identity = arxivIdentity(url.pathname.replace(/^\/10\.48550\/arxiv\./i, ''));
    return identity ? `https://arxiv.org/abs/${identity.id}` : undefined;
  }
  url.hash = '';
  return url.href;
}

function urlIdentity(url: string | undefined): ArxivIdentity | undefined {
  return url?.startsWith('https://arxiv.org/abs/') ? arxivIdentity(url.slice('https://arxiv.org/abs/'.length)) : undefined;
}

function identitiesConflict(expected: ArxivIdentity, actual: ArxivIdentity): boolean {
  return expected.base.toLowerCase() !== actual.base.toLowerCase()
    || Boolean(expected.version && actual.version && expected.version !== actual.version);
}

function cleanText(element: Element | null): string | undefined {
  if (!element) return undefined;
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('script,style,noscript,iframe,.descriptor').forEach(node => node.remove());
  return clone.textContent?.replace(/\s+/g, ' ').trim() || undefined;
}

function plainText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ABSTRACT_LENGTH) return undefined;
  return cleanText(new DOMParser().parseFromString(value, 'text/html').body);
}

function authorName(value: string): string | undefined {
  const name = plainText(value);
  if (!name) return undefined;
  const pieces = name.split(',').map(piece => piece.trim());
  return pieces.length === 2 && pieces.every(Boolean) ? `${pieces[1]} ${pieces[0]}` : name;
}

function metadata(document: Document): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const node of document.querySelectorAll('meta[name],meta[property]')) {
    const key = (node.getAttribute('name') ?? node.getAttribute('property'))?.toLowerCase();
    const value = node.getAttribute('content')?.trim();
    if (key && value && value.length <= MAX_ABSTRACT_LENGTH) values.set(key, [...(values.get(key) ?? []), value]);
  }
  return values;
}

type JsonRecord = Record<string, unknown>;
/** Only explicit ScholarlyArticle objects are considered; description is not abstract. */
function scholarlyArticles(document: Document): JsonRecord[] {
  const result: JsonRecord[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || result.length > 40) return;
    if (Array.isArray(value)) { value.slice(0, 100).forEach(item => visit(item, depth + 1)); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as JsonRecord;
    const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
    if (types.some(type => typeof type === 'string' && /(?:^|\/)ScholarlyArticle$/.test(type))) result.push(record);
    if (record['@graph']) visit(record['@graph'], depth + 1);
    if (record.mainEntity) visit(record.mainEntity, depth + 1);
  };
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 30)) {
    try { visit(JSON.parse(script.textContent ?? ''), 0); } catch { /* A malformed block must not break other metadata. */ }
  }
  return result;
}

function jsonAuthors(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).flatMap(author => {
    const name = plainText(typeof author === 'string' ? author : author && typeof author === 'object' ? (author as JsonRecord).name : undefined);
    return name ? [name] : [];
  });
}

function jsonDoi(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(jsonDoi).find(Boolean);
  if (typeof value === 'string') return normalizeDoi(value);
  if (value && typeof value === 'object') {
    const object = value as JsonRecord;
    return jsonDoi(object.value) ?? jsonDoi(object['@id']);
  }
  return undefined;
}

function extractYear(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /(?:^|\D)((?:18|19|20|21)\d{2})(?:\D|$)/.exec(value);
  return match ? Number(match[1]) : undefined;
}

/**
 * Parse detached, inert HTML only. Generic pages need citation metadata or a
 * ScholarlyArticle plus title and DOI / author-year corroboration. Arbitrary
 * prose, Open Graph descriptions, snippets, and JS-rendered abstracts are not
 * supported. A recognized paper without an abstract can still be supplemented.
 */
export function extractSourcePaper(html: string, pageUrl: string, seed: PaperSeed): Paper | undefined {
  if (!html.trim() || html.length > MAX_HTML_LENGTH) return undefined;
  const sourceUrl = normalizeSourceUrl(pageUrl);
  if (!sourceUrl) return undefined;
  const arxiv = urlIdentity(sourceUrl);
  const seedArxiv = urlIdentity(normalizeSourceUrl(seed.url));
  if (seedArxiv && (!arxiv || identitiesConflict(seedArxiv, arxiv)
    || Boolean(seedArxiv.version && seedArxiv.version !== arxiv.version))) return undefined;

  const document = new DOMParser().parseFromString(html, 'text/html');
  if (/\b(?:access denied|just a moment|verify (?:that )?you are human|captcha|sign in|log in)\b/i.test(document.title)
    || document.querySelector('input[type="password"],.g-recaptcha,#challenge-form')) return undefined;
  const meta = metadata(document);
  const first = (...keys: string[]): string | undefined => keys.map(key => meta.get(key)?.[0]).find(Boolean);
  const articles = scholarlyArticles(document).filter(article => normalizeTitle(plainText(article.headline ?? article.name) ?? '') === normalizeTitle(seed.title));
  if (articles.length > 1) return undefined;
  const article = articles[0];
  const title = plainText(first('citation_title', 'dc.title'))
    ?? (arxiv ? cleanText(document.querySelector('h1.title'))?.replace(/^title\s*:\s*/i, '') : undefined)
    ?? plainText(article?.headline ?? article?.name);
  if (!title || !normalizeTitle(seed.title) || normalizeTitle(title) !== normalizeTitle(seed.title)) return undefined;

  const authors = [...new Set((meta.get('citation_author') ?? []).map(authorName).filter((value): value is string => Boolean(value)))];
  if (!authors.length && article) authors.push(...jsonAuthors(article.author));
  if (!authors.length && arxiv) authors.push(...[...document.querySelectorAll('.authors a')].map(cleanText).filter((value): value is string => Boolean(value)));
  if (authors.length && seed.authors.length && !authorsOverlap(seed.authors, authors)) return undefined;
  const year = extractYear(first('citation_date', 'citation_publication_date', 'dc.date', 'dc.date.issued') ?? article?.datePublished);
  const seedDoi = normalizeDoi(seed.doi);
  const statedDois = [...(meta.get('citation_doi') ?? []), ...(meta.get('dc.identifier.doi') ?? []),
    jsonDoi(article?.identifier), jsonDoi(article?.sameAs)].map(value => normalizeDoi(value)).filter((value): value is string => Boolean(value));
  const statedDoi = statedDois[0];
  const metaArxiv = arxivIdentity(first('citation_arxiv_id'));
  const pdfValue = first('citation_pdf_url');
  let preprint: boolean | undefined = seed.preprint;
  let doi: string | undefined = statedDoi;
  let downloadUrl: string | undefined;
  let downloadVersion: string | undefined;
  if (arxiv) {
    if (seed.preprint === false || (metaArxiv && identitiesConflict(arxiv, metaArxiv))) return undefined;
    for (const value of statedDois) {
      const doiArxiv = value.startsWith('10.48550/arxiv.') ? arxivIdentity(value.slice('10.48550/arxiv.'.length)) : undefined;
      if (doiArxiv && identitiesConflict(arxiv, doiArxiv)) return undefined;
    }
    // citation_doi on arXiv may identify the journal publication. Never attach
    // that DOI to this preprint or use it to justify a published-version seed.
    doi = arxiv.base.includes('/') ? undefined : `10.48550/arxiv.${arxiv.base.toLowerCase()}`;
    if (seedDoi && seedDoi !== doi) {
      const seedDoiArxiv = seedDoi.startsWith('10.48550/arxiv.') ? arxivIdentity(seedDoi.slice('10.48550/arxiv.'.length)) : undefined;
      if (!seedDoiArxiv || identitiesConflict(seedDoiArxiv, arxiv)
        || (seedDoiArxiv.version && seedDoiArxiv.version !== arxiv.version)) return undefined;
    }
    if (pdfValue) {
      const pdfArxiv = urlIdentity(normalizeSourceUrl(pdfValue.replace(/^http:\/\/(?:www\.)?arxiv\.org\//i, 'https://arxiv.org/')));
      if (pdfArxiv && identitiesConflict(arxiv, pdfArxiv)) return undefined;
    }
    preprint = true;
    downloadUrl = `https://arxiv.org/pdf/${arxiv.id}`;
    downloadVersion = `submittedVersion${arxiv.version ? ` (${arxiv.version})` : ''}`;
  } else {
    if (!first('citation_title') && !article) return undefined;
    if (new Set(statedDois).size > 1) return undefined;
    if (seedDoi && statedDoi && seedDoi !== statedDoi) return undefined;
    const doiMatch = Boolean(seedDoi && seedDoi === statedDoi);
    if (!doiMatch && (!seed.year || seed.year !== year || !authorsOverlap(seed.authors, authors))) return undefined;
    const venue = first('citation_journal_title');
    const isKnownPreprint = /(?:^|\.)(?:biorxiv|medrxiv|arxiv)\.org$/.test(new URL(sourceUrl).hostname)
      || Boolean(venue && /(?:arxiv|biorxiv|medrxiv|preprints?)/i.test(venue));
    if (isKnownPreprint) preprint = true;
    else if (venue) preprint = false;
    if (seed.preprint !== undefined && preprint !== undefined && seed.preprint !== preprint) return undefined;
    if (pdfValue) {
      try { downloadUrl = publicUrl(new URL(pdfValue, sourceUrl).href)?.href; } catch { /* Ignore malformed downloads. */ }
      if (downloadUrl && preprint === false && urlIdentity(normalizeSourceUrl(downloadUrl))) downloadUrl = undefined;
    }
  }
  const rawAbstract = (arxiv ? cleanText(document.querySelector('blockquote.abstract')) : undefined)
    ?? plainText(first('citation_abstract', 'dcterms.abstract'))
    ?? (arxiv ? plainText(first('dc.description')) : undefined)
    ?? plainText(article?.abstract);
  const abstract = rawAbstract?.replace(/^abstract\s*:\s*/i, '').trim();
  return {
    id: arxiv ? `arxiv:${arxiv.id}` : `source:${sourceUrl}`,
    title, authors: authors.length ? authors : [...seed.authors], year: year ?? seed.year,
    venue: plainText(first('citation_journal_title', 'citation_conference_title')) ?? (arxiv ? 'arXiv' : seed.venue),
    url: sourceUrl, sourceUrl, source: 'Original page', matchStatus: 'matched', preprint, doi,
    ...(abstract && abstract.length <= MAX_ABSTRACT_LENGTH ? { abstract } : {}),
    ...(downloadUrl ? { downloadUrl, downloadVersion } : {}),
    sources: [{ name: 'Original page', url: sourceUrl }],
  };
}
