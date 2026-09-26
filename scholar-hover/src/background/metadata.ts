import type { Paper, PaperSeed, Resolution } from '../shared/types';
import { canUseDoiMatch, chooseUniqueMatch, normalizeDoi, type MatchableWork } from '../shared/matching';
import { readSourcePaper, type SourceReader } from './source';
import { normalizeSourceUrl } from '../shared/source-page';

const OPENALEX_WORKS = 'https://api.openalex.org/works';
const CROSSREF_WORKS = 'https://api.crossref.org/works';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ABSTRACT_WORDS = 20_000;
const MAX_ABSTRACT_POSITION = 50_000;

type OpenAlexWork = MatchableWork & {
  id?: unknown;
  display_name?: unknown;
  primary_location?: unknown;
  abstract_inverted_index?: unknown;
};

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function stableId(seed: PaperSeed): string {
  const text = [seed.title, seed.authors.join('|'), seed.year ?? '', seed.doi ?? '', seed.url].join('\u001f');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `scholar:${(hash >>> 0).toString(36)}`;
}

function workId(work: OpenAlexWork): string | undefined {
  if (typeof work.id !== 'string') return undefined;
  const match = work.id.match(/\/([^/?#]+)\/?$/);
  return match?.[1] || undefined;
}

export function reconstructAbstract(index: unknown): string | undefined {
  if (!index || typeof index !== 'object' || Array.isArray(index)) return undefined;
  const words = new Map<number, string>();
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!word || !Array.isArray(positions)) return undefined;
    for (const position of positions) {
      if (!Number.isSafeInteger(position) || position < 0 || position > MAX_ABSTRACT_POSITION || words.has(position)) return undefined;
      words.set(position, word);
      if (words.size > MAX_ABSTRACT_WORDS) return undefined;
    }
  }
  if (!words.size) return undefined;
  const max = Math.max(...words.keys());
  const result: string[] = [];
  for (let position = 0; position <= max; position += 1) {
    const word = words.get(position);
    if (!word) return undefined;
    result.push(word);
  }
  return result.join(' ');
}

function stripXml(markup: unknown): string | undefined {
  if (typeof markup !== 'string' || !markup.trim()) return undefined;
  const text = markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/&(?:lt|#60);/gi, '<')
    .replace(/&(?:gt|#62);/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

export function unresolvedPaper(seed: PaperSeed): Paper {
  return {
    ...seed,
    url: safeUrl(seed.url) ?? '',
    id: stableId(seed),
    source: seed.linkOnly ? 'Link' : 'Google Scholar',
    sourceUrl: safeUrl(seed.url) ?? (seed.linkOnly ? '' : 'https://scholar.google.com/'),
    matchStatus: 'unresolved',
  };
}

function locationUrl(work: OpenAlexWork): string | undefined {
  if (!work.primary_location || typeof work.primary_location !== 'object') return undefined;
  const location = work.primary_location as { landing_page_url?: unknown; pdf_url?: unknown };
  return safeUrl(location.landing_page_url) ?? safeUrl(location.pdf_url);
}

function locationSourceName(work: OpenAlexWork): string | undefined {
  if (!work.primary_location || typeof work.primary_location !== 'object') return undefined;
  const source = (work.primary_location as { source?: unknown }).source;
  return source && typeof source === 'object' && typeof (source as { display_name?: unknown }).display_name === 'string'
    ? (source as { display_name: string }).display_name
    : undefined;
}

function workAuthors(work: OpenAlexWork): string[] {
  if (!Array.isArray(work.authorships)) return [];
  return work.authorships.flatMap((authorship) => {
    if (!authorship || typeof authorship !== 'object') return [];
    const author = (authorship as { author?: unknown }).author;
    if (!author || typeof author !== 'object') return [];
    const name = (author as { display_name?: unknown }).display_name;
    return typeof name === 'string' && name.trim() ? [name.trim()] : [];
  });
}

function paperFromWork(work: OpenAlexWork, sourceUrl: string, matchStatus: Paper['matchStatus'], includeAbstract: boolean): Paper | undefined {
  const id = workId(work);
  const title = typeof work.title === 'string' && work.title.trim() ? work.title : typeof work.display_name === 'string' && work.display_name.trim() ? work.display_name : undefined;
  if (!id || !title) return undefined;
  const canonicalUrl = locationUrl(work);
  const sourceName = locationSourceName(work);
  const doi = normalizeDoi(typeof work.doi === 'string' ? work.doi : undefined);
  const sources = [
    { name: 'OpenAlex', url: safeUrl(typeof work.id === 'string' ? work.id : undefined) },
    canonicalUrl ? { name: sourceName ?? 'Publisher', url: canonicalUrl } : undefined,
  ].filter((entry): entry is { name: string; url: string } => Boolean(entry?.url));
  const primary = work.primary_location && typeof work.primary_location === 'object'
    ? work.primary_location as { pdf_url?: unknown; version?: unknown } : undefined;
  // Open-access alternatives can be an earlier manuscript. Preserve the matched
  // primary publication version instead of silently substituting that copy.
  const downloadUrl = safeUrl(primary?.pdf_url);
  return {
    title,
    authors: workAuthors(work),
    url: canonicalUrl ?? sourceUrl,
    doi,
    year: typeof work.publication_year === 'number' ? work.publication_year : undefined,
    venue: sourceName,
    preprint: typeof work.type === 'string' ? /preprint/i.test(work.type) : undefined,
    id,
    ...(downloadUrl ? { downloadUrl, downloadVersion: typeof primary?.version === 'string' ? primary.version : undefined } : {}),
    source: 'OpenAlex',
    sourceUrl,
    sources: sources.length ? sources : undefined,
    abstract: includeAbstract ? reconstructAbstract(work.abstract_inverted_index) : undefined,
    matchStatus,
  };
}

async function parseJsonWithinLimit(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error('响应内容过大');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('响应正文不可读取');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) throw new Error('响应内容过大');
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function requestJson(url: string, key: string | undefined, timings: Record<string, number>, timingKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error', headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await parseJsonWithinLimit(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('请求超时');
    throw error;
  } finally {
    clearTimeout(timeout);
    timings[timingKey] = Date.now() - startedAt;
  }
}

async function supplementAbstract(doi: string, timings: Record<string, number>): Promise<string | undefined> {
  const url = `${CROSSREF_WORKS}/${encodeURIComponent(doi)}`;
  // An OpenAlex token is scoped to OpenAlex and must never be sent to Crossref.
  const body = await requestJson(url, undefined, timings, 'crossref');
  if (!body || typeof body !== 'object') return undefined;
  const message = (body as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return undefined;
  const crossrefDoi = normalizeDoi(typeof (message as { DOI?: unknown }).DOI === 'string' ? (message as { DOI: string }).DOI : undefined);
  return crossrefDoi === doi ? stripXml((message as { abstract?: unknown }).abstract) : undefined;
}

function attachCrossrefAbstractSource(paper: Paper, doi: string): void {
  const url = `${CROSSREF_WORKS}/${encodeURIComponent(doi)}`;
  paper.sources = [...(paper.sources ?? []), { name: 'Crossref · 摘要', url }];
}

function warningFor(error: unknown, provider = 'OpenAlex'): string {
  const detail = error instanceof Error ? error.message : '未知网络错误';
  return `${provider} 查询失败：${detail}`;
}

/** Query indexes only after trying the user's actual paper link. */
export async function resolvePaper(seed: PaperSeed, openAlexKey?: string, reader?: SourceReader): Promise<Resolution> {
  const timings: Record<string, number> = {};
  const source = await readSourcePaper(seed, timings, reader);
  const direct = source.paper;
  if (direct?.abstract) return { paper: direct, candidates: [], timings, lookupVersion: 2 };
  // A link label is not a paper title. Query indexes only after the linked page
  // established an identity that can be corroborated, never search its label.
  if (seed.linkOnly && (!direct || (!normalizeDoi(direct.doi) && (!direct.year || !direct.authors.length)))) {
    return { ...source, paper: direct ?? unresolvedPaper(seed), candidates: [], timings, lookupVersion: 2 };
  }
  // An arXiv URL identifies a manuscript (and sometimes an exact revision).
  // Indexes cannot verify that revision, so never replace it with another work.
  const sourceUrl = normalizeSourceUrl(seed.url);
  if (sourceUrl && new URL(sourceUrl).hostname === 'arxiv.org') {
    return { ...source, paper: direct ?? unresolvedPaper(seed), candidates: [], timings, lookupVersion: 2 };
  }
  const indexed = await resolveIndexedPaper(direct ?? seed, openAlexKey);
  const result: Resolution = { ...indexed, timings: { ...timings, ...indexed.timings }, lookupVersion: 2 };
  if (direct) {
    // Copy an indexed abstract only with the same DOI and publication kind;
    // retain the actual linked page's identity, metadata and PDF version.
    const sameDoi = normalizeDoi(direct.doi) && normalizeDoi(direct.doi) === normalizeDoi(indexed.paper.doi);
    const sameKind = direct.preprint === indexed.paper.preprint;
    const abstract = sameDoi && sameKind && indexed.paper.matchStatus !== 'unresolved' ? indexed.paper.abstract : undefined;
    result.paper = { ...direct, ...(abstract ? { abstract, sources: [...(direct.sources ?? []), ...(indexed.paper.sources ?? []), { name: indexed.paper.source, url: indexed.paper.sourceUrl }] } : {}) };
    result.candidates = [];
  }
  if (!result.paper.abstract) {
    result.warning = [source.warning, indexed.warning].filter(Boolean).join('；') || undefined;
    if (source.sourceAccess) result.sourceAccess = source.sourceAccess;
  }
  return result;
}

/** Resolve only a high-confidence index record; other candidates stay reviewable. */
async function resolveIndexedPaper(seed: PaperSeed, openAlexKey?: string): Promise<Resolution> {
  const timings: Record<string, number> = {};
  const doi = normalizeDoi(seed.doi);
  const apiUrl = doi
    ? `${OPENALEX_WORKS}/https://doi.org/${encodeURIComponent(doi)}`
    : `${OPENALEX_WORKS}?search=${encodeURIComponent(seed.title)}&per-page=5`;
  let body: unknown;
  try {
    body = await requestJson(apiUrl, openAlexKey, timings, 'openalex');
  } catch (error) {
    return { paper: unresolvedPaper(seed), candidates: [], warning: warningFor(error), timings };
  }

  if (doi) {
    const work = body && typeof body === 'object' ? body as OpenAlexWork : undefined;
    if (!work || !canUseDoiMatch(seed, work)) {
      return { paper: unresolvedPaper(seed), candidates: [], warning: 'DOI 查询返回了冲突或不完整的记录。', timings };
    }
    const paper = paperFromWork(work, apiUrl, 'matched', true);
    if (!paper) return { paper: unresolvedPaper(seed), candidates: [], warning: 'DOI 查询返回了格式异常的记录。', timings };
    if (!paper.abstract) {
      try {
        const abstract = await supplementAbstract(doi, timings);
        if (abstract) {
          paper.abstract = abstract;
          attachCrossrefAbstractSource(paper, doi);
        }
      } catch (error) {
        return { paper, candidates: [], warning: `OpenAlex 已匹配，但${warningFor(error, 'Crossref')}`, timings };
      }
    }
    return { paper, candidates: [], timings };
  }

  const results = body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results)
    ? (body as { results: unknown[] }).results.slice(0, 5).filter((work): work is OpenAlexWork => Boolean(work && typeof work === 'object'))
    : [];
  const match = chooseUniqueMatch(seed, results);
  if (match) {
    const paper = paperFromWork(match as OpenAlexWork, apiUrl, 'matched', true);
    if (paper) {
      const matchedDoi = normalizeDoi(paper.doi);
      if (!paper.abstract && matchedDoi) {
        try {
          const abstract = await supplementAbstract(matchedDoi, timings);
          if (abstract) {
            paper.abstract = abstract;
            attachCrossrefAbstractSource(paper, matchedDoi);
          }
        } catch (error) {
          return { paper, candidates: [], warning: `OpenAlex 已匹配，但${warningFor(error, 'Crossref')}`, timings };
        }
      }
      return { paper, candidates: [], timings };
    }
  }
  const candidates = results
    .map((work) => paperFromWork(work, safeUrl(typeof work.id === 'string' ? work.id : undefined) ?? apiUrl, 'unresolved', true))
    .filter((paper): paper is Paper => Boolean(paper));
  return { paper: unresolvedPaper(seed), candidates, warning: candidates.length ? '存在多个或无法验证的候选记录，需要人工确认。' : '未找到可验证的 OpenAlex 匹配记录。', timings };
}
