import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaperSeed } from '../src/shared/types';
import { reconstructAbstract, resolvePaper } from '../src/background/metadata';

const seed: PaperSeed = {
  title: 'A Reliable Paper',
  authors: ['J. Doe', 'Y. \u738b'],
  year: 2024,
  url: 'https://scholar.google.com/scholar?cluster=123',
  doi: '10.5555/reliable.1',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function openAlexWork(overrides: Record<string, unknown> = {}) {
  return {
    id: 'https://openalex.org/W123', doi: 'https://doi.org/10.5555/reliable.1', title: seed.title,
    publication_year: 2024, type: 'article', primary_location: { source: { display_name: 'Journal of Reliable Results' }, landing_page_url: 'https://doi.org/10.5555/reliable.1' },
    authorships: [{ author: { display_name: 'Jane Doe' } }, { author: { display_name: '\u738b\u4e91' } }],
    abstract_inverted_index: { A: [0], reliable: [1], abstract: [2] },
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('resolvePaper', () => {
  it('keeps the primary publication PDF without silently choosing an OA manuscript', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(openAlexWork({ primary_location: { pdf_url: 'https://journal.test/paper.pdf', landing_page_url: 'https://journal.test/article', version: 'publishedVersion' }, best_oa_location: { pdf_url: 'https://preprint.test/old.pdf', version: 'submittedVersion' } }))));
    expect((await resolvePaper(seed)).paper).toMatchObject({ downloadUrl: 'https://journal.test/paper.pdf', downloadVersion: 'publishedVersion' });
  });
  it('does not substitute an OA preprint when the primary PDF is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(openAlexWork({ best_oa_location: { pdf_url: 'https://preprint.test/old.pdf', version: 'submittedVersion' } }))));
    expect((await resolvePaper(seed)).paper.downloadUrl).toBeUndefined();
  });
  it('rejects credential-bearing and executable full-text URLs', async () => {
    for (const pdf_url of ['javascript:alert(1)', 'https://secret:token@journal.test/paper.pdf']) {
      vi.stubGlobal('fetch', vi.fn(async () => response(openAlexWork({ primary_location: { pdf_url } }))));
      expect((await resolvePaper(seed)).paper.downloadUrl).toBeUndefined();
    }
  });
  it('looks up a DOI directly, uses an explicit bearer key, and reconstructs an OpenAlex abstract', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/works/https://doi.org/10.5555%2Freliable.1');
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key');
      return response(openAlexWork());
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolvePaper(seed, 'test-key');

    expect(result.paper).toMatchObject({ id: 'W123', source: 'OpenAlex', matchStatus: 'matched', abstract: 'A reliable abstract' });
    expect(result.paper.sourceUrl).toBe('https://api.openalex.org/works/https://doi.org/10.5555%2Freliable.1');
    expect(result.timings?.openalex).toBeTypeOf('number');
  });

  it('does not substitute a different DOI even when its title is close', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(openAlexWork({ doi: 'https://doi.org/10.5555/other.9' }))));

    const result = await resolvePaper(seed);

    expect(result.paper.matchStatus).toBe('unresolved');
    expect(result.paper.id).toContain('scholar:');
    expect(result.warning).toMatch(/DOI/i);
  });

  it('does not treat the published version as the DOI match for a preprint result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(openAlexWork({ type: 'article' }))));

    const result = await resolvePaper({ ...seed, preprint: true });

    expect(result.paper.matchStatus).toBe('unresolved');
    expect(result.warning).toMatch(/冲突/);
  });

  it('supplements a missing OpenAlex abstract from Crossref only when its DOI agrees', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('api.openalex.org')) return response(openAlexWork({ abstract_inverted_index: null }));
      return response({ message: { DOI: '10.5555/reliable.1', abstract: '<jats:p>A <italic>JATS</italic> abstract.</jats:p>' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolvePaper(seed);

    expect(result.paper).toMatchObject({ matchStatus: 'matched', abstract: 'A JATS abstract.' });
    expect(result.paper.source).toBe('OpenAlex');
    expect(result.paper.sources).toEqual(expect.arrayContaining([{ name: 'Crossref · 摘要', url: 'https://api.crossref.org/works/10.5555%2Freliable.1' }]));
    expect(result.timings?.crossref).toBeTypeOf('number');
  });

  it('does not infer an abstract when neither source contains one', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('api.openalex.org')) return response(openAlexWork({ abstract_inverted_index: undefined }));
      return response({ message: { DOI: '10.5555/reliable.1' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolvePaper(seed);

    expect(result.paper.matchStatus).toBe('matched');
    expect(result.paper.abstract).toBeUndefined();
  });

  it('does not accept an XML abstract from Crossref when the DOI differs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('api.openalex.org')) return response(openAlexWork({ abstract_inverted_index: undefined }));
      return response({ message: { DOI: '10.5555/conflicting.2', abstract: '<jats:p>Wrong paper.</jats:p>' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolvePaper(seed);

    expect(result.paper.abstract).toBeUndefined();
  });

  it('returns an explicit unresolved page paper after a 429 and retains timing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'rate limit' }, 429)));

    const result = await resolvePaper({ ...seed, doi: undefined });

    expect(result.paper).toMatchObject({ title: seed.title, source: 'Google Scholar', matchStatus: 'unresolved' });
    expect(result.paper.abstract).toBeUndefined();
    expect(result.warning).toMatch(/OpenAlex.*429/);
    expect(result.timings?.openalex).toBeTypeOf('number');
  });

  it('returns an unresolved paper when the request times out', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    vi.useFakeTimers();
    const pending = resolvePaper({ ...seed, doi: undefined });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    vi.useRealTimers();

    expect(result.paper.matchStatus).toBe('unresolved');
    expect(result.warning).toMatch(/超时/);
    expect(result.timings?.openalex).toBeTypeOf('number');
  });

  it('offers ambiguous title-search candidates with their own metadata and abstract for later confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ results: [
      { id: 'https://openalex.org/Wbad', title: null, publication_year: 2024 },
      openAlexWork({ id: 'https://openalex.org/W1', doi: null, title: 'A Reliable Paper', authorships: [{ author: { display_name: 'Alice Other' } }], primary_location: { source: { display_name: 'Other Journal' }, landing_page_url: 'https://example.org/other' } }),
      openAlexWork({ id: 'https://openalex.org/W2', doi: null, authorships: [{ author: { display_name: 'Bob Different' } }], abstract_inverted_index: { unsafe: ['nope'] } }),
    ] })));

    const result = await resolvePaper({ ...seed, doi: undefined, venue: 'Scholar Venue' });

    expect(result.paper.matchStatus).toBe('unresolved');
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['W1', 'W2']);
    expect(result.candidates[0]).toMatchObject({ authors: ['Alice Other'], venue: 'Other Journal', doi: undefined, abstract: 'A reliable abstract' });
    expect(result.candidates[0].sources).toEqual(expect.arrayContaining([{ name: 'Other Journal', url: 'https://example.org/other' }]));
    expect(result.candidates[1].abstract).toBeUndefined();
  });

  it('supplements a title-search match from Crossref when OpenAlex has a DOI but no abstract', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('api.openalex.org')) return response({ results: [openAlexWork({ abstract_inverted_index: undefined })] });
      return response({ message: { DOI: '10.5555/reliable.1', abstract: '<jats:p>Recovered abstract.</jats:p>' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolvePaper({ ...seed, doi: undefined });

    expect(result.paper).toMatchObject({ matchStatus: 'matched', abstract: 'Recovered abstract.' });
    expect(result.paper.sources).toEqual(expect.arrayContaining([{ name: 'Crossref · 摘要', url: 'https://api.crossref.org/works/10.5555%2Freliable.1' }]));
    expect(result.timings?.crossref).toBeTypeOf('number');
  });
});

describe('reconstructAbstract', () => {
  it('rejects unreasonably sparse or oversized inverted indexes', () => {
    expect(reconstructAbstract({ token: [50_001] })).toBeUndefined();
    expect(reconstructAbstract(Object.fromEntries(Array.from({ length: 20_001 }, (_, index) => [`w${index}`, [index]])))).toBeUndefined();
  });
});
