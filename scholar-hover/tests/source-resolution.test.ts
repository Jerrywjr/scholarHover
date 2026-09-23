import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePaper } from '../src/background/metadata';
import type { Paper, PaperSeed } from '../src/shared/types';

const seed: PaperSeed = { title: 'NetConfArena: An Executable Benchmark for LLM Agents in Closed-Loop Network Configuration', authors: ['C Liu', 'X Xie', 'X Chen', 'Y Cui'], year: 2026, preprint: true, url: 'https://arxiv.org/pdf/2608.23179v1' };
const paper: Paper = { ...seed, id: 'arxiv:2608.23179v1', url: 'https://arxiv.org/abs/2608.23179v1', abstract: 'An abstract from the linked paper.', source: 'Original page', sourceUrl: 'https://arxiv.org/abs/2608.23179v1', matchStatus: 'matched' };
const reader = (overrides = {}) => ({ hasPermission: async () => true, parseHtml: async () => paper, ...overrides });
afterEach(() => vi.unstubAllGlobals());

describe('source-first resolution', () => {
  it('reads the linked arXiv version and skips OpenAlex even when the index would return 429', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(url);
      if (url.includes('api.openalex.org')) return new Response('{}', { status: 429 });
      expect(init?.credentials).toBe('omit');
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      return new Response('<html>paper</html>', { headers: { 'content-type': 'text/html' } });
    }));
    const result = await resolvePaper(seed, 'private-openalex-key', reader());
    expect(result.paper.abstract).toBe(paper.abstract);
    expect(result.paper.source).toBe('Original page');
    expect(result.lookupVersion).toBe(2);
    expect(result.warning).toBeUndefined();
    expect(requests).toEqual(['https://arxiv.org/abs/2608.23179v1']);
  });

  it('reports exact missing source permission without fetching that host', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return new Response('{}', { status: 429 }); }));
    const result = await resolvePaper({ ...seed, url: 'https://journal.example/article/one', preprint: undefined }, undefined, reader({ hasPermission: async () => false }));
    expect(result.sourceAccess).toEqual({ url: 'https://journal.example/article/one', origin: 'https://journal.example' });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('api.openalex.org');
    expect(result.warning).toContain('OpenAlex');
  });

  it('does not substitute another indexed version when a versioned arXiv page fails', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return new Response('Unavailable', { status: 503 }); }));
    const result = await resolvePaper(seed, undefined, reader());
    expect(result.paper.matchStatus).toBe('unresolved');
    expect(result.paper.abstract).toBeUndefined();
    expect(result.warning).toContain('原文');
    expect(result.warning).toContain('503');
    expect(urls).toEqual(['https://arxiv.org/abs/2608.23179v1']);
  });

  it('rejects oversized/PDF/login responses and never sends them for translation', async () => {
    for (const response of [
      new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
      new Response('<html>oversize</html>', { headers: { 'content-type': 'text/html', 'content-length': '9000000' } }),
      new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => response));
      const result = await resolvePaper(seed, undefined, reader({ parseHtml: async () => undefined }));
      expect(result.paper.abstract).toBeUndefined();
      expect(result.paper.matchStatus).toBe('unresolved');
      expect(result.warning).toContain('原文');
    }
  });

  it('does not replace confirmed source identity when the index returns a different paper', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('api.openalex.org')
      ? new Response(JSON.stringify({ results: [] }), { headers: { 'content-type': 'application/json' } })
      : new Response('<html>paper</html>', { headers: { 'content-type': 'text/html' } })));
    const direct = { ...paper, url: 'https://journal.example/article/one', sourceUrl: 'https://journal.example/article/one', abstract: undefined, preprint: undefined };
    const result = await resolvePaper({ ...seed, url: direct.url, preprint: undefined }, undefined, reader({ parseHtml: async () => direct }));
    expect(result.paper).toMatchObject({ id: direct.id, source: 'Original page', matchStatus: 'matched' });
    expect(result.candidates).toEqual([]);
  });
});
