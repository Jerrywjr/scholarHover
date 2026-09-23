import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseResult, startContentScript } from '../src/content/index.ts';
import { chooseUniqueMatch } from '../src/shared/matching.ts';
import type { Generated, Paper, PreviewSnapshot, Request, SavedPaper, SettingsView } from '../src/shared/types.ts';

const paper = (overrides = '') => {
  document.body.innerHTML = `
    <div class="gs_r gs_or gs_scl" ${overrides}>
      <h3 class="gs_rt"><a href="https://doi.org/10.1000/example">[PDF] A Safe Paper Title</a></h3>
      <div class="gs_a">Ada Lovelace, A. Turing, Grace Hopper - Journal of Tests, 2024 - example.org</div>
      <div class="gs_rs">A shortened Scholar result snippet.</div>
    </div>`;
  return document.querySelector('.gs_r')!;
};

const titleTarget = (result: Element) => result.querySelector('.gs_rt')!;

const settings = { uiLanguage: 'zh-CN' as const, outputLanguage: 'zh-CN' as const, baseUrl: '', model: '', autoGenerate: false, consent: false, rememberKey: false, hasApiKey: false, hasOpenAlexKey: false };
const matched = (title = 'Resolved', id = 'paper-1') => ({ paper: { id, title, authors: ['Ada Lovelace'], year: 2024, venue: 'Journal', url: 'https://paper.test', abstract: 'A real abstract.', source: 'OpenAlex' as const, sourceUrl: 'https://api.openalex.org/works/x', matchStatus: 'matched' as const }, candidates: [] });
const flush = async () => { for (let tick = 0; tick < 12; tick += 1) await Promise.resolve(); };
const generated = (language: Generated['language'], titleTranslated: string): Generated => ({ language, titleTranslated, abstractTranslated: 'Translated abstract.', summary: 'A summary.', model: 'm', fingerprint: language, createdAt: 1 });
const cardRoot = () => document.getElementById('scholar-hover-card')!.shadowRoot!;
// Existing interaction fixtures represent an uncached paper; archive cases are explicit below.
function stubUncachedRuntime(value: { runtime: { sendMessage: (message: Request) => unknown } }) {
  vi.stubGlobal('chrome', { runtime: { sendMessage: (message: Request) => message.type === 'GET_PREVIEW'
    ? Promise.resolve({ ok: true, data: {} }) : message.type === 'GET_PREVIEW_STATES'
      ? Promise.resolve({ ok: true, data: message.seeds.map(() => 'unknown') }) : value.runtime.sendMessage(message) } });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('cache-first previews and early saving', () => {
  it('refreshes an old no-abstract HTTP 429 preview once while retaining its cached title', async () => {
    vi.useFakeTimers(); const result = paper();
    const stale = { ...matched('Old cached title'), paper: { ...matched('Old cached title').paper, abstract: undefined, matchStatus: 'unresolved' as const }, warning: '元数据查询失败：HTTP 429' };
    const titleOnly = { ...generated('zh-CN', '已有标题译文'), abstractTranslated: null, summary: null };
    let finishResolution!: (value: unknown) => void;
    const sendMessage = vi.fn((message: Request) => message.type === 'RESOLVE' ? new Promise(resolve => { finishResolution = resolve; })
      : Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, model: 'm' }
        : message.type === 'GET_PREVIEW' ? { resolution: stale, generated: titleOnly, needsRefresh: true } : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    try {
      titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
      expect(cardRoot().textContent).toContain('已有标题译文');
      expect(sendMessage.mock.calls.filter(([message]) => message.type === 'RESOLVE')).toHaveLength(1);
      titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(5000);
      expect(sendMessage.mock.calls.filter(([message]) => message.type === 'RESOLVE')).toHaveLength(1);
      finishResolution({ ok: true, data: { ...matched('Recovered from source'), lookupVersion: 2 } }); await flush();
      expect(cardRoot().querySelector('h2')?.textContent).toBe('Recovered from source');
      expect(cardRoot().textContent).toContain('A real abstract.');
      expect(cardRoot().textContent).not.toContain('HTTP 429');
    } finally { stop(); }
  });

  it('keeps a complete cached abstract local even if the old preview is marked stale', async () => {
    vi.useFakeTimers(); const result = paper();
    const sendMessage = vi.fn((message: Request) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings
      : message.type === 'GET_PREVIEW' ? { resolution: matched(), generated: generated('zh-CN', '完整译文'), needsRefresh: true } : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    try {
      titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
      expect(cardRoot().textContent).toContain('完整译文');
      expect(sendMessage.mock.calls.some(([message]) => ['RESOLVE', 'GENERATE'].includes(message.type))).toBe(false);
    } finally { stop(); }
  });

  it('offers metadata retry alongside an existing title translation without another paid model request', async () => {
    vi.useFakeTimers(); const result = paper();
    const resolution = { ...matched(), paper: { ...matched().paper, abstract: undefined }, lookupVersion: 2 };
    let finishResolution!: (value: unknown) => void;
    const sendMessage = vi.fn((message: Request) => message.type === 'RESOLVE' ? new Promise(resolve => { finishResolution = resolve; })
      : Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, model: 'm', autoGenerate: true, consent: true, hasApiKey: true }
        : message.type === 'GET_PREVIEW' ? { resolution, generated: { ...generated('zh-CN', '只有标题译文'), abstractTranslated: null, summary: null } } : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    try {
      titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
      const retry = cardRoot().querySelector<HTMLButtonElement>('[data-action="retry-metadata"]');
      expect(retry?.textContent).toBe('重新读取摘要'); retry?.click(); await flush();
      cardRoot().querySelector<HTMLButtonElement>('[data-action="retry-metadata"]')?.click(); await flush();
      expect(sendMessage.mock.calls.filter(([message]) => message.type === 'RESOLVE')).toEqual([[{ type: 'RESOLVE', seed: parseResult(result), retry: true }]]);
      finishResolution({ ok: true, data: resolution }); await flush();
      expect(cardRoot().textContent).toContain('只有标题译文');
      expect(cardRoot().querySelector<HTMLButtonElement>('[data-action="retry-metadata"]')?.disabled).toBe(false);
      expect(sendMessage.mock.calls.some(([message]) => message.type === 'GENERATE')).toBe(false);
    } finally { stop(); }
  });

  it.each<[string, Partial<Paper>]>([
    ['title', { title: 'Corrected source title' }],
    ['authors', { authors: ['Grace Hopper'] }],
    ['year', { year: 2025 }],
    ['venue', { venue: 'Corrected Journal' }],
    ['url', { url: 'https://publisher.example/new-version' }],
    ['doi', { doi: '10.1000/corrected' }],
    ['source', { source: 'Original page' }],
    ['sourceUrl', { sourceUrl: 'https://publisher.example/article/42' }],
    ['preprint', { preprint: true }],
  ])('revalidates title-only output when metadata retry changes %s for the same paper ID', async (_field, changed) => {
    vi.useFakeTimers(); const result = paper();
    const resolution = { ...matched(), paper: { ...matched().paper, abstract: undefined }, lookupVersion: 2 };
    const fresh = { ...resolution, paper: { ...resolution.paper, ...changed } };
    const titleOnly = { ...generated('zh-CN', '过期标题译文'), abstractTranslated: null, summary: null };
    const cached = { ...titleOnly, titleTranslated: '更新后的缓存译文' };
    let finishCache!: (value: unknown) => void;
    const sendMessage = vi.fn((message: Request) => message.type === 'GET_CACHED' ? new Promise(resolve => { finishCache = resolve; })
      : Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, model: 'm', autoGenerate: true, consent: true, hasApiKey: true }
        : message.type === 'GET_PREVIEW' ? { resolution, generated: titleOnly } : message.type === 'RESOLVE' ? fresh : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    try {
      titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
      expect(cardRoot().textContent).toContain('过期标题译文');
      cardRoot().querySelector<HTMLButtonElement>('[data-action="retry-metadata"]')?.click(); await flush();
      expect(cardRoot().textContent).not.toContain('过期标题译文');
      expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_CACHED')).toEqual([[{ type: 'GET_CACHED', paperId: 'paper-1' }]]);
      finishCache({ ok: true, data: cached }); await flush();
      expect(cardRoot().textContent).toContain('更新后的缓存译文');
      expect(sendMessage.mock.calls.some(([message]) => message.type === 'GENERATE')).toBe(false);
    } finally { stop(); }
  });

  it('reports failed lookup without requesting candidate confirmation when no candidate exists', async () => {
    vi.useFakeTimers(); const result = paper();
    const resolution = { paper: { ...matched().paper, abstract: undefined, matchStatus: 'unresolved' }, candidates: [], warning: '元数据查询失败：HTTP 429', lookupVersion: 2 };
    const sendMessage = vi.fn((message: Request) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings
      : message.type === 'GET_PREVIEW' ? { resolution } : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    try {
      titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
      expect(cardRoot().querySelector('.footer > .status')?.textContent).toContain('查询失败');
      expect(cardRoot().textContent).not.toContain('请确认条目');
      expect(cardRoot().querySelector('[data-action="confirm"]')).toBeNull();
      expect(cardRoot().querySelector('[data-action="generate"]')?.textContent).toBe('生成中文信息');
    } finally { stop(); }
  });

  it('opens scoped source access and retries metadata only once on return focus', async () => {
    vi.useFakeTimers(); const result = paper();
    const resolution = { ...matched(), paper: { ...matched().paper, abstract: undefined }, lookupVersion: 2,
      sourceAccess: { url: 'https://publisher.example/article', origin: 'https://publisher.example' } };
    const sendMessage = vi.fn((message: Request) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings
      : message.type === 'GET_PREVIEW' ? { resolution } : message.type === 'RESOLVE' ? matched() : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    try {
      titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
      const access = cardRoot().querySelector<HTMLButtonElement>('[data-action="source-access"]');
      expect(access?.textContent).toBe('允许读取原文网站'); access?.click(); await flush();
      expect(sendMessage.mock.calls.filter(([message]) => message.type === 'OPEN_SOURCE_ACCESS')).toEqual([[{ type: 'OPEN_SOURCE_ACCESS', seed: parseResult(result) }]]);
      window.dispatchEvent(new Event('focus')); await flush(); window.dispatchEvent(new Event('focus')); await flush();
      expect(sendMessage.mock.calls.filter(([message]) => message.type === 'RESOLVE')).toEqual([[{ type: 'RESOLVE', seed: parseResult(result), retry: true }]]);
      expect(cardRoot().textContent).toContain('A real abstract.');
    } finally { stop(); }
  });

  it('refreshes saved completion after a deliberate metadata retry and leaves generation to the background', async () => {
    vi.useFakeTimers(); const result = paper();
    const resolution = { ...matched(), paper: { ...matched().paper, abstract: undefined }, lookupVersion: 2 };
    const saved: SavedPaper = { id: 'saved-1', paper: resolution.paper, savedAt: 1, updatedAt: 1, completion: { status: 'failed', updatedAt: 1 } };
    let snapshot: PreviewSnapshot = { resolution, saved };
    const sendMessage = vi.fn((message: Request) => {
      if (message.type === 'RESOLVE') snapshot = { resolution: matched(), saved: { ...saved, paper: matched().paper, completion: { status: 'generating', updatedAt: 2 } } };
      return Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, autoGenerate: true, consent: true, hasApiKey: true }
        : message.type === 'GET_PREVIEW' ? snapshot : message.type === 'RESOLVE' ? matched() : undefined });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    try {
      titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
      expect(cardRoot().querySelector('.save-status')?.textContent).toContain('补全失败');
      cardRoot().querySelector<HTMLButtonElement>('[data-action="retry-metadata"]')?.click(); await flush();
      expect(cardRoot().querySelector('.save-status')?.textContent).toContain('正在后台生成');
      expect(sendMessage.mock.calls.some(([message]) => message.type === 'GENERATE')).toBe(false);
      expect(cardRoot().querySelector('[data-action="save"]')?.textContent).toContain('已缓存');
    } finally { stop(); }
  });

  it('loads saved and viewed badges in one local batch before hovering and hides unknown states', async () => {
    const first = paper();
    for (let index = 1; index <= 3; index++) {
      const next = first.cloneNode(true) as Element; next.querySelector('a')!.textContent = `Paper ${index}`;
      next.querySelector('a')!.setAttribute('href', `https://paper-${index}.test`); document.body.append(next);
    }
    let finishStates!: (value: unknown) => void;
    const sendMessage = vi.fn((message: Request) => message.type === 'GET_PREVIEW_STATES'
      ? new Promise(resolve => { finishStates = resolve; }) : Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript(); await flush();
    expect(document.querySelector('[data-scholar-hover-badge]')).toBeNull();
    const batches = sendMessage.mock.calls.filter(([message]) => message.type === 'GET_PREVIEW_STATES');
    expect(batches).toHaveLength(1); expect((batches[0][0] as Extract<Request, { type: 'GET_PREVIEW_STATES' }>).seeds).toHaveLength(4);
    finishStates({ ok: true, data: ['saved', 'viewed', 'unknown', 'unviewed'] }); await flush();
    const results = document.querySelectorAll<HTMLElement>('.gs_r');
    expect(Array.from(results).map(result => result.dataset.scholarHoverState)).toEqual(['saved', 'viewed', 'unknown', 'unviewed']);
    expect(results[0].querySelector('[data-scholar-hover-badge]')?.textContent).toBe('已缓存');
    expect(results[2].querySelector('[data-scholar-hover-badge]')).toBeNull();
    expect(sendMessage.mock.calls.some(([message]) => ['GET_PREVIEW', 'RESOLVE', 'GENERATE', 'GET_CACHED'].includes(message.type))).toBe(false); stop();
  });

  it('batches new results and focus refreshes without letting old badge reads overwrite a saved paper', async () => {
    vi.useFakeTimers(); const first = paper();
    const replies: Array<(value: unknown) => void> = [];
    let saved: SavedPaper | undefined;
    const sendMessage = vi.fn((message: Request) => {
      if (message.type === 'GET_PREVIEW_STATES') return new Promise(resolve => replies.push(resolve));
      if (message.type === 'SAVE_PAPER') saved = { id: 'saved-a', paper: matched().paper, savedAt: 1, updatedAt: 2 };
      return Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'GET_PREVIEW' ? { resolution: matched(), saved } : message.type === 'SAVE_PAPER' ? saved : undefined });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.click(); await flush();
    replies[0]({ ok: true, data: ['unviewed'] }); await flush();
    expect(first.getAttribute('data-scholar-hover-state')).toBe('saved');
    const second = first.cloneNode(true) as Element; second.querySelector('a')!.textContent = 'New result'; second.querySelector('a')!.setAttribute('href', 'https://new-result.test'); document.body.append(second); await flush();
    const batches = sendMessage.mock.calls.filter(([message]) => message.type === 'GET_PREVIEW_STATES');
    expect(batches).toHaveLength(2); expect((batches[1][0] as Extract<Request, { type: 'GET_PREVIEW_STATES' }>).seeds.map(seed => seed.title)).toEqual(['New result']);
    replies[1]({ ok: true, data: ['viewed'] }); await flush();
    expect(second.getAttribute('data-scholar-hover-state')).toBe('viewed');
    window.dispatchEvent(new Event('focus')); await flush();
    window.dispatchEvent(new Event('focus')); await flush();
    replies[3]({ ok: true, data: ['saved', 'saved'] }); await flush();
    replies[2]({ ok: true, data: ['unviewed', 'unviewed'] }); await flush();
    expect(first.getAttribute('data-scholar-hover-state')).toBe('saved');
    expect(second.getAttribute('data-scholar-hover-state')).toBe('saved'); stop();
  });

  it('paints archived metadata and translated output together without network resolution or generation', async () => {
    vi.useFakeTimers(); const result = paper();
    const saved: SavedPaper = { id: 'saved-1', paper: matched().paper, savedAt: 1, updatedAt: 2, completion: { status: 'ready', updatedAt: 2 } };
    const sendMessage = vi.fn((message: Request) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, model: 'm' } : message.type === 'GET_PREVIEW' ? { resolution: matched(), generated: generated('zh-CN', '完整缓存译文'), saved } : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    const frames: string[] = [];
    const paints = new MutationObserver(() => { if (cardRoot().querySelector('.card')) frames.push(cardRoot().querySelector('.translated')?.textContent ?? ''); });
    paints.observe(cardRoot(), { childList: true });
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(499); expect(cardRoot().querySelector('.card')).toBeNull();
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(cardRoot().querySelector('h2')?.textContent).toBe('Resolved');
    expect(cardRoot().querySelector('.translated')?.textContent).toBe('完整缓存译文');
    expect(cardRoot().querySelector('[data-action="save"]')?.textContent).toContain('已缓存');
    expect(result.getAttribute('data-scholar-hover-state')).toBe('saved');
    expect(sendMessage.mock.calls.filter(([message]) => ['RESOLVE', 'GET_CACHED', 'GENERATE'].includes(message.type))).toHaveLength(0);
    expect(frames).toEqual(['完整缓存译文']); paints.disconnect(); stop();
  });

  it('saves the visible source seed before metadata returns and leaves browsing unlocked', async () => {
    vi.useFakeTimers(); const result = paper(); let finishSave!: (value: unknown) => void;
    const sendMessage = vi.fn((message: Request) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: settings });
      if (message.type === 'GET_PREVIEW') return Promise.resolve({ ok: true, data: {} });
      if (message.type === 'SAVE_PAPER') return new Promise(resolve => { finishSave = resolve; });
      return new Promise(() => {});
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    const seed = parseResult(result)!; const save = cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!;
    expect(save.disabled).toBe(false); save.click(); save.click(); await flush();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'SAVE_PAPER')).toEqual([[{ type: 'SAVE_PAPER', seed }]]);
    expect(cardRoot().querySelector('[data-action="pin"]')?.getAttribute('aria-pressed')).toBe('false');
    finishSave({ ok: true, data: { id: 'seed-saved', paper: { ...seed, id: 'seed-saved', source: 'Google Scholar', sourceUrl: seed.url, matchStatus: 'unresolved' }, savedAt: 1, updatedAt: 1, completion: { status: 'resolving', updatedAt: 1 } } }); await flush();
    expect(cardRoot().querySelector('[data-action="save"]')?.textContent).toContain('已缓存');
    expect(cardRoot().querySelector('.save-status')?.textContent).toContain('后台');
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'GENERATE')).toBe(false); stop();
  });

  it('restores a saved paper completed in the background after switching to another result', async () => {
    vi.useFakeTimers(); const first = paper(); const second = first.cloneNode(true) as Element;
    second.querySelector('a')!.textContent = 'Another paper'; second.querySelector('a')!.setAttribute('href', 'https://other.test'); document.body.append(second);
    const seed = parseResult(first)!;
    let snapshot: PreviewSnapshot = {};
    const saved: SavedPaper = { id: 'saved-a', paper: matched().paper, savedAt: 1, updatedAt: 1, completion: { status: 'generating', updatedAt: 1 } };
    const sendMessage = vi.fn((message: Request) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, model: 'm' } : message.type === 'GET_PREVIEW' ? message.seed.url === seed.url ? snapshot : {} : message.type === 'RESOLVE' ? matched(message.seed.title) : message.type === 'SAVE_PAPER' ? saved : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.click(); await flush();
    titleTarget(second).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(cardRoot().querySelector('h2')?.textContent).toBe('Another paper');
    snapshot = { resolution: matched(), generated: generated('zh-CN', '后台完成的译文'), saved: { ...saved, completion: { status: 'ready', updatedAt: 3 } } };
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    expect(cardRoot().textContent).toContain('后台完成的译文');
    expect(cardRoot().querySelector('[data-action="save"]')?.textContent).toContain('已缓存');
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GENERATE')).toHaveLength(0); stop();
  });

  it('does not reuse translated output from an old model or output language', async () => {
    vi.useFakeTimers(); const result = paper();
    const sendMessage = vi.fn((message: Request) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, outputLanguage: 'de', model: 'new-model' } : message.type === 'GET_PREVIEW' ? { resolution: matched(), generated: generated('de', 'Old model translation') } : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    expect(cardRoot().textContent).not.toContain('Old model translation'); expect(cardRoot().querySelector('h2')?.textContent).toBe('Resolved');
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'RESOLVE')).toBe(false); stop();
  });

  it('polls saved completion without model requests and stops when ready', async () => {
    vi.useFakeTimers(); const result = paper();
    let status: 'generating' | 'ready' = 'generating';
    const sendMessage = vi.fn((message: Request) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS'
      ? { ...settings, autoGenerate: true, consent: true, hasApiKey: true, model: 'm' }
      : message.type === 'GET_PREVIEW' ? { resolution: matched(), saved: { id: 'saved-a', paper: matched().paper, savedAt: 1, updatedAt: 1, completion: { status, updatedAt: 1 } }, ...(status === 'ready' ? { generated: generated('zh-CN', '后台完成') } : {}) } : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(cardRoot().querySelector('.save-status')?.textContent).toContain('后台');
    status = 'ready'; await vi.advanceTimersByTimeAsync(1100);
    expect(cardRoot().textContent).toContain('后台完成');
    const reads = sendMessage.mock.calls.filter(([message]) => message.type === 'GET_PREVIEW').length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_PREVIEW')).toHaveLength(reads);
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'GENERATE')).toBe(false); stop();
  });

  it('continues the cache-first lookup when initial settings arrive after the card opens', async () => {
    vi.useFakeTimers(); const result = paper(); let settingsLoaded!: (value: unknown) => void;
    const sendMessage = vi.fn((message: Request) => message.type === 'GET_SETTINGS' ? new Promise(resolve => { settingsLoaded = resolve; })
      : Promise.resolve({ ok: true, data: message.type === 'GET_PREVIEW' ? { resolution: matched(), generated: generated('fr', 'Titre archivé') } : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    settingsLoaded({ ok: true, data: { ...settings, model: 'm', outputLanguage: 'fr' } }); await flush();
    expect(cardRoot().textContent).toContain('Titre archivé');
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'RESOLVE')).toBe(false); stop();
  });

  it('deduplicates A-to-B-to-A saves and ignores a pre-save preview arriving after save succeeds', async () => {
    vi.useFakeTimers(); const first = paper(); const second = first.cloneNode(true) as Element;
    second.querySelector('a')!.textContent = 'Other'; second.querySelector('a')!.setAttribute('href', 'https://other.test'); document.body.append(second);
    const seed = parseResult(first)!; let previewReads = 0; let finishSave!: (value: unknown) => void; let oldPreview!: (value: unknown) => void;
    const sendMessage = vi.fn((message: Request) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: settings });
      if (message.type === 'SAVE_PAPER') return new Promise(resolve => { finishSave = resolve; });
      if (message.type === 'GET_PREVIEW') {
        if (message.seed.url === seed.url && ++previewReads === 2) return new Promise(resolve => { oldPreview = resolve; });
        return Promise.resolve({ ok: true, data: {} });
      }
      return new Promise(() => {});
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
    titleTarget(second).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    const save = cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!; expect(save.disabled).toBe(true); save.click();
    finishSave({ ok: true, data: { id: 'saved-a', paper: matched().paper, savedAt: 1, updatedAt: 2, completion: { status: 'generating', updatedAt: 2 } } }); await flush();
    oldPreview({ ok: true, data: {} }); await flush();
    expect(cardRoot().querySelector('[data-action="save"]')?.textContent).toContain('已缓存');
    expect(document.getElementById('scholar-hover-card')?.dataset.saved).toBe('true');
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'SAVE_PAPER')).toHaveLength(1); stop();
  });

  it('preserves saved progress on a cache-read failure and does not start another model call', async () => {
    vi.useFakeTimers(); const result = paper(); let reads = 0;
    const sendMessage = vi.fn((message: Request) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: { ...settings, autoGenerate: true, consent: true, hasApiKey: true } });
      if (message.type === 'GET_PREVIEW') return Promise.resolve(++reads === 1 ? { ok: true, data: { resolution: matched(), saved: { id: 'saved-a', paper: matched().paper, savedAt: 1, updatedAt: 1, completion: { status: 'generating', updatedAt: 1 } } } } : { ok: false, error: '扩展存储初始化失败，请重新加载扩展。' });
      return Promise.resolve({ ok: true, data: undefined });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1100);
    expect(cardRoot().querySelector('[data-action="save"]')?.textContent).toContain('已缓存');
    expect(result.getAttribute('data-scholar-hover-state')).toBe('saved');
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'GENERATE')).toBe(false); stop();
  });

  it('rejects a stale prefetch when save finishes during the return hover delay', async () => {
    vi.useFakeTimers(); const first = paper(); const second = first.cloneNode(true) as Element;
    second.querySelector('a')!.textContent = 'Other'; second.querySelector('a')!.setAttribute('href', 'https://other.test'); document.body.append(second);
    const seed = parseResult(first)!; let reads = 0; let finishSave!: (value: unknown) => void; let oldPreview!: (value: unknown) => void;
    const saved: SavedPaper = { id: 'saved-a', paper: matched().paper, savedAt: 1, updatedAt: 2, completion: { status: 'generating', updatedAt: 2 } };
    const sendMessage = vi.fn((message: Request) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: settings });
      if (message.type === 'SAVE_PAPER') return new Promise(resolve => { finishSave = resolve; });
      if (message.type === 'GET_PREVIEW') {
        if (message.seed.url !== seed.url) return Promise.resolve({ ok: true, data: {} });
        reads += 1;
        if (reads === 2) return new Promise(resolve => { oldPreview = resolve; });
        return Promise.resolve({ ok: true, data: reads > 2 ? { resolution: matched(), saved } : {} });
      }
      return new Promise(() => {});
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
    titleTarget(second).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(250);
    finishSave({ ok: true, data: saved }); await flush();
    await vi.advanceTimersByTimeAsync(250); oldPreview({ ok: true, data: {} }); await flush();
    expect(cardRoot().querySelector('[data-action="save"]')?.textContent).toContain('已缓存');
    expect(reads).toBe(3); stop();
  });

  it('resumes hover generation after an old preview is invalidated by changed settings', async () => {
    vi.useFakeTimers(); const result = paper(); let reads = 0; let oldPreview!: (value: unknown) => void;
    let preferences: SettingsView = { ...settings, model: 'm', consent: true, hasApiKey: true };
    const sendMessage = vi.fn((message: Request) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: preferences });
      if (message.type === 'GET_PREVIEW') return ++reads === 1 ? Promise.resolve({ ok: true, data: { resolution: matched() } }) : new Promise(resolve => { oldPreview = resolve; });
      return Promise.resolve({ ok: true, data: message.type === 'GENERATE' ? generated('fr', 'Nouveau résultat') : undefined });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    titleTarget(result).dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    preferences = { ...preferences, outputLanguage: 'fr', autoGenerate: true }; window.dispatchEvent(new Event('focus')); await flush();
    oldPreview({ ok: true, data: { resolution: matched() } }); await flush();
    document.getElementById('scholar-hover-card')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await flush();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GENERATE')).toHaveLength(1);
    expect(cardRoot().textContent).toContain('Nouveau résultat'); stop();
  });

  it('retains metadata and generated text while showing independent archive-write warnings', async () => {
    vi.useFakeTimers(); const result = paper();
    const cacheWarning = '扩展存储初始化失败，请重新加载扩展。';
    const resolution = { ...matched(), warning: '元数据查询失败：HTTP 429', cacheWarning };
    const sendMessage = vi.fn((message: Request) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings
      : message.type === 'RESOLVE' ? resolution : message.type === 'GENERATE' ? { ...generated('zh-CN', '生成成功的译文'), cacheWarning } : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } }); const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(cardRoot().querySelector('.cache-warning')?.textContent).toContain('扩展存储初始化失败');
    expect(cardRoot().querySelector('.warning:not(.cache-warning)')?.textContent).toContain('HTTP 429');
    cardRoot().querySelector<HTMLButtonElement>('[data-action="generate"]')!.click(); await flush();
    expect(cardRoot().querySelector('.translated')?.textContent).toBe('生成成功的译文');
    expect(cardRoot().querySelector('.footer > .status.failure')?.textContent).toContain('扩展存储初始化失败'); stop();
  });
});

describe('content languages', () => {
  it.each([
    ['zh-CN', '关闭', '正在核对公开文献记录…'],
    ['en', 'Close', 'Checking public literature records…'],
    ['fr', 'Fermer', 'Vérification des notices bibliographiques publiques…'],
    ['de', 'Schließen', 'Öffentliche Literaturdaten werden geprüft…'],
  ] as const)('localizes the initial loading card in %s before metadata returns', async (uiLanguage, close, loading) => {
    vi.useFakeTimers();
    const result = paper();
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => message.type === 'GET_SETTINGS'
      ? Promise.resolve({ ok: true, data: { ...settings, uiLanguage } })
      : new Promise(() => {})) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(cardRoot().querySelector('[data-action="close"]')?.textContent).toBe(close);
    expect(cardRoot().querySelector('[role="status"]')?.textContent).toBe(loading);
    expect(document.getElementById('scholar-hover-card')?.lang).toBe(uiLanguage);
    stop();
  });

  it('localizes unresolved cards without waiting for a generation or cache lookup', async () => {
    vi.useFakeTimers();
    const result = paper();
    const resolution = { paper: { ...matched().paper, matchStatus: 'unresolved' }, candidates: [matched('Candidate').paper] };
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, uiLanguage: 'en', outputLanguage: 'fr' } : resolution }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    expect(cardRoot().textContent).toContain('Choose the matching record');
    expect(cardRoot().querySelector('[data-action="generate"]')?.textContent).toBe('Generate French text');
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'GET_CACHED' || message.type === 'GENERATE')).toBe(false);
    stop();
  });

  it('renders the selected output language from cache independently of the UI language', async () => {
    vi.useFakeTimers();
    const result = paper();
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS'
      ? { ...settings, uiLanguage: 'en', outputLanguage: 'fr' }
      : message.type === 'RESOLVE' ? matched() : generated('fr', 'Titre français') }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    expect(cardRoot().querySelector('[role="status"]')?.textContent).toBe('Loaded from local cache.');
    expect(cardRoot().textContent).toContain('Titre français');
    expect(cardRoot().querySelector('summary')?.textContent).toBe('Show original abstract and French translation');
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'GENERATE')).toBe(false);
    stop();
  });

  it('repaints a pending generation when only UI language changes without another model request', async () => {
    vi.useFakeTimers();
    const result = paper();
    let preferences: SettingsView = { ...settings, consent: true, hasApiKey: true, autoGenerate: true };
    let finishGeneration!: (value: unknown) => void;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: preferences });
      if (message.type === 'RESOLVE') return Promise.resolve({ ok: true, data: matched() });
      if (message.type === 'GET_CACHED') return Promise.resolve({ ok: true, data: undefined });
      return new Promise(resolve => { finishGeneration = resolve; });
    });
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    cardRoot().querySelector<HTMLButtonElement>('[data-action="close"]')!.focus();
    preferences = { ...preferences, uiLanguage: 'en' };
    window.dispatchEvent(new Event('focus')); await flush();
    expect(cardRoot().querySelector('[role="status"]')?.textContent).toBe('Generating Chinese text…');
    expect((cardRoot().activeElement as HTMLElement)?.dataset.action).toBe('close');
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GENERATE')).toHaveLength(1);
    finishGeneration({ ok: true, data: generated('zh-CN', '仍然是中文结果') }); await flush();
    expect(cardRoot().textContent).toContain('仍然是中文结果');
    expect(cardRoot().querySelector('[role="status"]')?.textContent).toBe('Chinese text generated.');
    stop();
  });

  it('ignores an old generation after output language changes and starts the new language once', async () => {
    vi.useFakeTimers();
    const result = paper();
    let preferences: SettingsView = { ...settings, uiLanguage: 'en', consent: true, hasApiKey: true, autoGenerate: true };
    const completions: Array<(value: unknown) => void> = [];
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: preferences });
      if (message.type === 'RESOLVE') return Promise.resolve({ ok: true, data: matched() });
      if (message.type === 'GET_CACHED') return Promise.resolve({ ok: true, data: undefined });
      return new Promise(resolve => completions.push(resolve));
    });
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    preferences = { ...preferences, outputLanguage: 'de' };
    window.dispatchEvent(new Event('focus')); await flush();
    expect(completions).toHaveLength(2);
    expect(cardRoot().querySelector('[role="status"]')?.textContent).toBe('Generating German text…');
    completions[0]({ ok: true, data: generated('zh-CN', '过时的中文结果') }); await flush();
    expect(cardRoot().textContent).not.toContain('过时的中文结果');
    completions[1]({ ok: true, data: generated('de', 'Aktuelles deutsches Ergebnis') }); await flush();
    expect(cardRoot().textContent).toContain('Aktuelles deutsches Ergebnis');
    window.dispatchEvent(new Event('focus')); await flush();
    expect(completions).toHaveLength(2);
    stop();
  });

  it('does not show an outdated cache response after output language changes', async () => {
    vi.useFakeTimers();
    const result = paper();
    let preferences: SettingsView = { ...settings, uiLanguage: 'en' };
    let finishOldCache!: (value: unknown) => void;
    let cacheCalls = 0;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: preferences });
      if (message.type === 'RESOLVE') return Promise.resolve({ ok: true, data: matched() });
      if (message.type === 'GET_CACHED' && cacheCalls++ === 0) return new Promise(resolve => { finishOldCache = resolve; });
      return Promise.resolve({ ok: true, data: generated('fr', 'Cache français') });
    });
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    preferences = { ...preferences, outputLanguage: 'fr' };
    window.dispatchEvent(new Event('focus')); await flush();
    finishOldCache({ ok: true, data: generated('zh-CN', '错误语言缓存') }); await flush();
    expect(cardRoot().textContent).toContain('Cache français');
    expect(cardRoot().textContent).not.toContain('错误语言缓存');
    stop();
  });

  it('does not accept a cached result with a language different from current output settings', async () => {
    vi.useFakeTimers();
    const result = paper();
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS'
      ? { ...settings, outputLanguage: 'en' } : message.type === 'RESOLVE' ? matched() : generated('zh-CN', '错误缓存') })) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    expect(cardRoot().textContent).not.toContain('错误缓存');
    expect(cardRoot().querySelector('[data-action="generate"]')).not.toBeNull();
    stop();
  });

  it('retranslates a visible backend failure when the UI language changes', async () => {
    vi.useFakeTimers();
    const result = paper();
    let preferences: SettingsView = { ...settings, uiLanguage: 'en', consent: true, hasApiKey: true, autoGenerate: true };
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: preferences });
      if (message.type === 'RESOLVE') return Promise.resolve({ ok: true, data: matched() });
      if (message.type === 'GET_CACHED') return Promise.resolve({ ok: true, data: undefined });
      return Promise.resolve({ ok: false, error: 'API Key 无效或未获授权' });
    });
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    expect(cardRoot().querySelector('.failure')?.textContent).toBe('The API key is invalid or unauthorized.');
    preferences = { ...preferences, uiLanguage: 'fr' };
    window.dispatchEvent(new Event('focus')); await flush();
    expect(cardRoot().querySelector('.failure')?.textContent).toBe('La clé API est invalide ou non autorisée.');
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GENERATE')).toHaveLength(1);
    stop();
  });

  it('localizes metadata warnings and source labels in an English card', async () => {
    vi.useFakeTimers();
    const result = paper();
    const resolution = { ...matched(), paper: { ...matched().paper, sources: [{ name: 'Crossref · 摘要', url: 'https://api.crossref.org/works/test' }] }, warning: 'OpenAlex 已匹配，但元数据查询失败：HTTP 429' };
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS'
      ? { ...settings, uiLanguage: 'en' } : message.type === 'RESOLVE' ? resolution : undefined })) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    expect(cardRoot().querySelector('.warning')?.textContent).toBe('OpenAlex matched, but Metadata lookup failed: HTTP 429');
    expect(cardRoot().querySelector('.sources')?.textContent).toContain('Crossref · Abstract');
    expect(cardRoot().querySelector('.sources')?.textContent).not.toMatch(/[\u3400-\u9fff]/u);
    stop();
  });

  it('allows a new output language after another language failed', async () => {
    vi.useFakeTimers();
    const result = paper();
    let preferences: SettingsView = { ...settings, consent: true, hasApiKey: true, autoGenerate: true };
    let attempts = 0;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: preferences });
      if (message.type === 'RESOLVE') return Promise.resolve({ ok: true, data: matched() });
      if (message.type === 'GET_CACHED') return Promise.resolve({ ok: true, data: undefined });
      attempts += 1;
      return Promise.resolve(attempts === 1 ? { ok: false, error: '模型服务请求失败' } : { ok: true, data: generated('en', 'English result after retry') });
    });
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    preferences = { ...preferences, outputLanguage: 'en' };
    window.dispatchEvent(new Event('focus')); await flush();
    expect(cardRoot().textContent).toContain('English result after retry');
    expect(attempts).toBe(2);
    stop();
  });

  it('preserves Chinese defaults when stored preferences predate language settings', async () => {
    vi.useFakeTimers();
    const result = paper();
    const { uiLanguage: _uiLanguage, outputLanguage: _outputLanguage, ...legacySettings } = settings;
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS'
      ? legacySettings : message.type === 'RESOLVE' ? matched() : undefined })) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    expect(cardRoot().querySelector('[data-action="generate"]')?.textContent).toBe('生成中文信息');
    expect(document.getElementById('scholar-hover-card')?.lang).toBe('zh-CN');
    stop();
  });
});

describe('parseResult', () => {
  it('parses only Scholar result cards and removes format badges from the title', () => {
    const result = paper();
    expect(parseResult(result)).toEqual({
      title: 'A Safe Paper Title',
      authors: ['Ada Lovelace', 'A. Turing', 'Grace Hopper'],
      year: 2024,
      venue: 'Journal of Tests',
      url: 'https://doi.org/10.1000/example',
      doi: '10.1000/example',
    });
    expect(parseResult(document.createElement('div'))).toBeNull();
  });

  it('supports citation-only result titles without inventing an abstract', () => {
    document.body.innerHTML = `<div class="gs_r gs_or gs_scl"><h3 class="gs_rt">[HTML] Citation title</h3><div class="gs_a">S. Author - 2019 - cited.example</div></div>`;
    expect(parseResult(document.querySelector('.gs_r')!)).toMatchObject({
      title: 'Citation title', authors: ['S. Author'], year: 2019, url: location.href,
    });
  });

  it('marks explicit preprint results so a same-title article cannot be silently matched', () => {
    document.body.innerHTML = `<div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://arxiv.org/abs/2401.01234">A Preprint Result</a></h3><div class="gs_a">A. Author - arXiv preprint, 2024</div></div>`;
    const seed = parseResult(document.querySelector('.gs_r')!)!;
    expect(seed.preprint).toBe(true);
    expect(chooseUniqueMatch(seed, [{ id: 'https://openalex.org/W-article', title: seed.title, publication_year: 2024, type: 'article', authorships: [{ author: { display_name: 'A. Author' } }] }])).toBeUndefined();
  });
});

describe('right-side panel placement', () => {
  it.each([[1280, 900, 420], [320, 600, 320]])('docks to the right and uses the full %sx%s viewport', async (width, height, panelWidth) => {
    vi.useFakeTimers();
    vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', height);
    const result = paper();
    vi.spyOn(result, 'getBoundingClientRect').mockReturnValue({ left: 30, right: 200, top: 520, bottom: 560 } as DOMRect);
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched() : undefined })) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    const host = document.getElementById('scholar-hover-card')!;
    expect(host.style.right).toBe('0px');
    expect(host.style.top).toBe('0px');
    expect(host.style.height).toBe(`${height}px`);
    expect(host.style.width).toBe(`${panelWidth}px`);
    expect(cardRoot().querySelector('[data-action="reset-height"]')).not.toBeNull();
    stop();
  });
});

describe('content interaction', () => {
  it('shows a disabled progress button and persistent feedback for a manual generation', async () => {
    vi.useFakeTimers();
    const result = paper();
    let finish!: (value: unknown) => void;
    const sendMessage = vi.fn((message: { type: string }) => message.type === 'GENERATE'
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched() : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    cardRoot().querySelector<HTMLButtonElement>('[data-action="generate"]')!.click();
    const pendingButton = cardRoot().querySelector<HTMLButtonElement>('[data-action="generate"]')!;
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.textContent).toContain('正在生成');
    expect(cardRoot().querySelector('.footer [role="status"]')?.textContent).toContain('正在生成');
    expect(cardRoot().querySelector('[data-action="pin"]')?.getAttribute('aria-pressed')).toBe('true');
    pendingButton.click();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GENERATE')).toHaveLength(1);
    cardRoot().querySelector<HTMLButtonElement>('[data-action="pin"]')!.click();
    expect(cardRoot().querySelector('.footer [role="status"]')?.textContent).toContain('正在生成');
    expect(cardRoot().querySelector<HTMLButtonElement>('[data-action="generate"]')?.disabled).toBe(true);
    finish({ ok: true, data: generated('zh-CN', '生成完成') }); await flush();
    expect(cardRoot().querySelector('.card')?.getAttribute('aria-busy')).toBe('false');
    expect(cardRoot().querySelector('.footer [role="status"]')?.textContent).toContain('已生成');
    stop();
  });

  it('keeps a generation failure beside an enabled explicit retry button', async () => {
    vi.useFakeTimers();
    const result = paper();
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve(message.type === 'GENERATE'
      ? { ok: false, error: 'API Key 无效或未获授权' }
      : { ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched() : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    cardRoot().querySelector<HTMLButtonElement>('[data-action="generate"]')!.click(); await flush();
    expect(cardRoot().querySelector('.footer .failure')?.textContent).toContain('API Key 无效');
    expect(cardRoot().querySelector<HTMLButtonElement>('[data-action="generate"]')?.disabled).toBe(false);
    expect(cardRoot().querySelector('[data-action="generate"]')?.textContent).toContain('重试');
    stop();
  });

  it('shows successful generated text with a separate saved-copy failure and allows updating the saved copy', async () => {
    vi.useFakeTimers();
    const result = paper();
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS'
      ? settings : message.type === 'RESOLVE' ? matched() : message.type === 'GENERATE'
        ? { ...generated('zh-CN', '译文生成成功'), collectionWarning: '缓存文章超过 4 MiB 容量，请先删除部分文章。' }
        : message.type === 'SAVE_PAPER' ? { id: 'paper-1', paper: matched().paper, savedAt: 1, updatedAt: 1 } : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.click(); await flush();
    cardRoot().querySelector<HTMLButtonElement>('[data-action="generate"]')!.click(); await flush();
    expect(cardRoot().querySelector('.translated')?.textContent).toBe('译文生成成功');
    expect(cardRoot().querySelector('.footer > .status')?.textContent).toContain('已生成');
    expect(cardRoot().querySelector('.save-status.failure')?.textContent).toContain('4 MiB');
    expect(cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.disabled).toBe(false);
    expect(cardRoot().querySelector('[data-action="save"]')?.textContent).toBe('已缓存 · 更新'); stop();
  });

  it('does not replace a pressed control when window focus only refreshes unchanged settings', async () => {
    vi.useFakeTimers();
    const result = paper();
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS'
      ? settings : message.type === 'RESOLVE' ? matched() : message.type === 'GENERATE' ? generated('zh-CN', '第一次点击成功') : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    const pressed = cardRoot().querySelector<HTMLButtonElement>('[data-action="generate"]')!;
    pressed.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    window.dispatchEvent(new Event('focus')); await flush();
    pressed.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await flush();
    expect(cardRoot().textContent).toContain('第一次点击成功');
    stop();
  });

  it('preserves abstract expansion and reading position when pinning redraws the card', async () => {
    vi.useFakeTimers();
    const result = paper();
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched() : undefined })) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    cardRoot().querySelector<HTMLDetailsElement>('details')!.open = true;
    cardRoot().querySelector<HTMLElement>('.body')!.scrollTop = 380;
    cardRoot().querySelector<HTMLButtonElement>('[data-action="pin"]')!.click();
    expect(cardRoot().querySelector<HTMLDetailsElement>('details')!.open).toBe(true);
    expect(cardRoot().querySelector<HTMLElement>('.body')!.scrollTop).toBe(380);
    stop();
  });

  it('resizes at both edges, stays docked, pins and resets to full height', async () => {
    vi.useFakeTimers(); vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 900);
    const result = paper();
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched() : undefined })) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    const host = document.getElementById('scholar-hover-card')!;
    const pointer = (type: string, y: number) => {
      const event = new MouseEvent(type, { clientX: 1000, clientY: y, button: 0, bubbles: true, composed: true, cancelable: true });
      Object.defineProperty(event, 'pointerId', { value: 1 }); return event;
    };
    cardRoot().querySelector('[data-edge="bottom"]')!.dispatchEvent(pointer('pointerdown', 900));
    document.dispatchEvent(pointer('pointermove', 700)); document.dispatchEvent(pointer('pointerup', 700));
    expect(host.style.height).toBe('700px'); expect(host.style.top).toBe('0px'); expect(host.style.right).toBe('0px');
    expect(cardRoot().querySelector('[data-action="pin"]')?.getAttribute('aria-pressed')).toBe('true');
    cardRoot().querySelector('[data-edge="top"]')!.dispatchEvent(pointer('pointerdown', 0));
    document.dispatchEvent(pointer('pointermove', 100)); document.dispatchEvent(pointer('pointerup', 100));
    expect(host.style.top).toBe('100px'); expect(host.style.height).toBe('600px');
    cardRoot().querySelector('[data-edge="bottom"]')!.dispatchEvent(pointer('pointerdown', 700));
    document.dispatchEvent(pointer('pointermove', -500)); document.dispatchEvent(pointer('pointerup', -500));
    expect(parseFloat(host.style.height)).toBeGreaterThanOrEqual(360);
    vi.stubGlobal('innerHeight', 500); window.dispatchEvent(new Event('resize'));
    expect(parseFloat(host.style.top) + parseFloat(host.style.height)).toBeLessThanOrEqual(500);
    cardRoot().querySelector<HTMLButtonElement>('[data-action="reset-height"]')!.click();
    expect(host.style.height).toBe('500px'); expect(host.style.top).toBe('0px');
    vi.stubGlobal('innerHeight', 900); window.dispatchEvent(new Event('resize'));
    expect(host.style.height).toBe('900px');
    cardRoot().querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    expect(host.style.display).toBe('none'); stop();
  });

  it('supports keyboard height changes without moving the panel horizontally', async () => {
    vi.useFakeTimers(); vi.stubGlobal('innerHeight', 900);
    const result = paper();
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched() : undefined })) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    const host = document.getElementById('scholar-hover-card')!;
    cardRoot().querySelector<HTMLButtonElement>('[data-action="pin"]')!.click();
    cardRoot().querySelector<HTMLButtonElement>('[data-action="pin"]')!.click();
    const edge = cardRoot().querySelector('[data-edge="bottom"]')!;
    edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(host.style.height).toBe('876px'); expect(host.style.right).toBe('0px');
    expect(cardRoot().querySelector('.status')?.textContent).toBe('卡片已固定。');
    expect(edge.getAttribute('aria-valuenow')).toBe('876');
    edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(host.style.height).toBe('900px'); stop();
  });

  it('saves the source seed and trusted paper ID once without pinning and reports durable collection feedback', async () => {
    vi.useFakeTimers();
    const result = paper();
    let finishSave!: (value: unknown) => void;
    const sendMessage = vi.fn((message: { type: string }) => message.type === 'SAVE_PAPER'
      ? new Promise(resolve => { finishSave = resolve; })
      : Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched() : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
    const saving = cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!;
    expect(saving.disabled).toBe(true); expect(saving.textContent).toContain('正在缓存'); saving.click();
    expect(cardRoot().querySelector('[data-action="pin"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'SAVE_PAPER')).toEqual([[{ type: 'SAVE_PAPER', seed: parseResult(result), paperId: 'paper-1' }]]);
    finishSave({ ok: true, data: { id: 'paper-1', paper: matched().paper, savedAt: 1, updatedAt: 1 } }); await flush();
    expect(cardRoot().querySelector('.save-status')?.textContent).toContain('已缓存');
    const update = cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!;
    expect(update.disabled).toBe(false); expect(update.textContent).toBe('已缓存 · 更新'); update.click();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'SAVE_PAPER')).toHaveLength(2);
    finishSave({ ok: true, data: { id: 'paper-1', paper: matched().paper, savedAt: 1, updatedAt: 2 } }); await flush();
    expect(cardRoot().querySelector('[data-action="collection"]')?.textContent).toBe('下载缓存文章'); stop();
  });

  it('saves an unresolved page record with its warning without choosing a candidate', async () => {
    vi.useFakeTimers();
    const result = paper();
    const resolution = { paper: { ...matched('Page metadata', 'page-only').paper, source: 'Google Scholar', abstract: undefined, matchStatus: 'unresolved' }, candidates: [matched('Not confirmed', 'candidate').paper], warning: '存在多个或无法验证的候选记录，需要人工确认。' };
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? resolution : { id: 'page-only', paper: resolution.paper, savedAt: 1, updatedAt: 1 } }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.click(); await flush();
    expect(cardRoot().querySelector('.warning')?.textContent).toBe('存在多个或无法验证的候选记录，需要人工确认。');
    expect(cardRoot().querySelector('.save-status')?.textContent).toContain('匹配尚未确认');
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'SAVE_PAPER')).toEqual([[{ type: 'SAVE_PAPER', seed: parseResult(result), paperId: 'page-only' }]]);
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'CONFIRM')).toBe(false); stop();
  });

  it('offers a manual retry after a save error and ignores save completion after close', async () => {
    vi.useFakeTimers();
    const result = paper(); let finishSave!: (value: unknown) => void; let attempts = 0;
    const sendMessage = vi.fn((message: { type: string }) => message.type === 'SAVE_PAPER'
      ? ++attempts === 1 ? Promise.resolve({ ok: false, error: '扩展存储初始化失败，请重新加载扩展。' }) : new Promise(resolve => { finishSave = resolve; })
      : Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched() : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.click(); await flush();
    expect(cardRoot().querySelector('.save-status.failure')?.textContent).toContain('扩展存储初始化失败');
    expect(cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.disabled).toBe(false);
    window.dispatchEvent(new Event('focus')); await flush(); expect(attempts).toBe(1);
    cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    finishSave({ ok: true, data: { id: 'paper-1', paper: matched().paper, savedAt: 1, updatedAt: 1 } }); await flush();
    expect(document.getElementById('scholar-hover-card')!.style.display).toBe('none');
    expect(cardRoot().querySelector('.save-status')).toBeNull(); stop();
  });

  it('opens the collection while metadata is still pending and localizes controls', async () => {
    vi.useFakeTimers();
    const result = paper();
    const sendMessage = vi.fn((message: { type: string }) => message.type === 'RESOLVE' ? new Promise(() => {})
      : Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, uiLanguage: 'en' } : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    expect(cardRoot().querySelector<HTMLButtonElement>('[data-action="save"]')!.disabled).toBe(false);
    expect(cardRoot().querySelector('[data-action="save"]')!.textContent).toBe('Save paper');
    expect(cardRoot().querySelector('[data-action="reset-height"]')!.textContent).toBe('Full height');
    cardRoot().querySelector<HTMLButtonElement>('[data-action="collection"]')!.click(); await flush();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'OPEN_COLLECTION')).toEqual([[{ type: 'OPEN_COLLECTION' }]]); stop();
  });

  it('debounces hover and resolves only after 500ms', async () => {
    vi.useFakeTimers();
    const seed = paper();
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched() : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(seed).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(499);
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'RESOLVE')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'RESOLVE')).toBe(true);
    stop();
  });

  it('keeps the docked panel open while crossing empty page space and closes on an outside click', async () => {
    vi.useFakeTimers();
    const result = paper();
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched() : undefined })) } });
    const stop = startContentScript();
    const heading = titleTarget(result);
    heading.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await flush();
    const host = document.getElementById('scholar-hover-card')!;
    heading.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.style.display).toBe('block');
    host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    host.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.style.display).toBe('block');
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(host.style.display).toBe('none'); stop();
  });

  it.each(['RESOLVE', 'GET_CACHED'] as const)('defers automatic generation if the title is left before %s returns, then resumes on panel entry', async (delayedType) => {
    vi.useFakeTimers();
    const result = paper();
    let finishPending!: (value: unknown) => void;
    let delayed = false;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: { ...settings, autoGenerate: true, consent: true, hasApiKey: true } });
      if (message.type === delayedType && !delayed) { delayed = true; return new Promise(resolve => { finishPending = resolve; }); }
      if (message.type === 'RESOLVE') return Promise.resolve({ ok: true, data: matched() });
      if (message.type === 'GENERATE') return Promise.resolve({ ok: true, data: generated('zh-CN', '回到面板才生成的译文') });
      return Promise.resolve({ ok: true, data: undefined });
    });
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    try {
      const heading = titleTarget(result);
      heading.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(500); await flush();
      expect(sendMessage.mock.calls.some(([message]) => message.type === delayedType)).toBe(true);
      heading.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
      await vi.advanceTimersByTimeAsync(1000);
      finishPending({ ok: true, data: delayedType === 'RESOLVE' ? matched() : undefined }); await flush();
      expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GENERATE')).toHaveLength(0);
      const host = document.getElementById('scholar-hover-card')!;
      expect(host.style.display).toBe('block');
      expect(cardRoot().textContent).toContain('A real abstract.');
      host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); await flush();
      expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GENERATE')).toHaveLength(1);
      expect(cardRoot().textContent).toContain('回到面板才生成的译文');
    } finally { stop(); }
  });

  it('does not resolve when the pointer leaves before the hover delay', async () => {
    vi.useFakeTimers();
    const result = paper();
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : matched() }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    const heading = titleTarget(result);
    heading.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    heading.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    await vi.advanceTimersByTimeAsync(600);
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'RESOLVE')).toBe(false);
    stop();
  });

  it('does not resolve when hovering non-title content inside a result card', async () => {
    vi.useFakeTimers();
    const result = paper();
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : matched() }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    result.querySelector('.gs_rs')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(600);
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'RESOLVE')).toBe(false);
    stop();
  });

  it('ignores a late resolve response after switching results', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://a.test">First</a></h3><div class="gs_a">A - 2020</div></div><div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://b.test">Second</a></h3><div class="gs_a">B - 2021</div></div>`;
    let resolveFirst!: (value: unknown) => void;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: settings });
      if (message.type === 'RESOLVE') return new Promise(resolve => { resolveFirst = resolve; });
      return Promise.resolve({ ok: true, data: undefined });
    });
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    const [first, second] = Array.from(document.querySelectorAll('.gs_r'));
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    titleTarget(second).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    resolveFirst({ ok: true, data: { paper: { id: 'one', title: 'First translated', authors: [], url: '', source: 'OpenAlex', sourceUrl: '', matchStatus: 'matched' }, candidates: [] } });
    await Promise.resolve();
    expect(document.body.textContent).not.toContain('First translated');
    stop();
  });

  it('preserves a card control focus when an async resolve redraws the card', async () => {
    vi.useFakeTimers();
    const result = paper();
    let resolveLater!: (value: unknown) => void;
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => message.type === 'RESOLVE'
      ? new Promise(resolve => { resolveLater = resolve; })
      : Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : undefined })) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    const root = document.getElementById('scholar-hover-card')!.shadowRoot!;
    root.querySelector<HTMLButtonElement>('[data-action="close"]')!.focus();
    resolveLater({ ok: true, data: matched() }); await Promise.resolve();
    expect((root.activeElement as HTMLElement | null)?.dataset.action).toBe('close');
    stop();
  });

  it('preserves an expanded abstract summary focus across a pending generation redraw', async () => {
    vi.useFakeTimers();
    const result = paper();
    let finishGeneration!: (value: unknown) => void;
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => {
      if (message.type === 'RESOLVE') return Promise.resolve({ ok: true, data: matched() });
      if (message.type === 'GET_CACHED') return Promise.resolve({ ok: true, data: undefined });
      if (message.type === 'GENERATE') return new Promise(resolve => { finishGeneration = resolve; });
      return Promise.resolve({ ok: true, data: settings });
    }) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve(); await Promise.resolve();
    const root = document.getElementById('scholar-hover-card')!.shadowRoot!;
    const details = root.querySelector<HTMLDetailsElement>('details')!; details.open = true;
    const summary = root.querySelector<HTMLElement>('summary')!; summary.focus();
    root.querySelector<HTMLButtonElement>('[data-action="generate"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    finishGeneration({ ok: true, data: { language: 'zh-CN', titleTranslated: '中文标题', abstractTranslated: '中文摘要', summary: '要点', model: 'm', fingerprint: 'f', createdAt: 1 } }); await Promise.resolve();
    expect(root.querySelector('details')?.open).toBe(true);
    expect(root.activeElement?.tagName).toBe('SUMMARY');
    stop();
  });

  it('preserves an original-paper link focus without stealing focus from outside the card', async () => {
    vi.useFakeTimers();
    const result = paper();
    const outside = document.createElement('button'); outside.textContent = 'outside'; document.body.append(outside);
    let finishGeneration!: (value: unknown) => void;
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => {
      if (message.type === 'RESOLVE') return Promise.resolve({ ok: true, data: matched() });
      if (message.type === 'GET_CACHED') return Promise.resolve({ ok: true, data: undefined });
      if (message.type === 'GENERATE') return new Promise(resolve => { finishGeneration = resolve; });
      return Promise.resolve({ ok: true, data: settings });
    }) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve(); await Promise.resolve();
    const root = document.getElementById('scholar-hover-card')!.shadowRoot!;
    root.querySelector<HTMLAnchorElement>('a.original')!.focus();
    root.querySelector<HTMLButtonElement>('[data-action="generate"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    finishGeneration({ ok: true, data: { language: 'zh-CN', titleTranslated: '中文标题', abstractTranslated: '中文摘要', summary: '要点', model: 'm', fingerprint: 'f', createdAt: 1 } }); await Promise.resolve();
    expect(root.activeElement?.className).toBe('original');
    outside.focus();
    root.querySelector<HTMLButtonElement>('[data-action="copy"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(document.activeElement).toBe(outside);
    stop();
  });

  it('closes on Escape and does not render a response that returns after close', async () => {
    vi.useFakeTimers();
    const result = paper();
    let resolveLater!: (value: unknown) => void;
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => message.type === 'GET_SETTINGS'
      ? Promise.resolve({ ok: true, data: settings })
      : new Promise(resolve => { resolveLater = resolve; })) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    resolveLater({ ok: true, data: { paper: { id: 'x', title: 'Late', authors: [], url: '', source: 'OpenAlex', sourceUrl: '', matchStatus: 'matched' }, candidates: [] } });
    await Promise.resolve();
    expect(document.body.textContent).not.toContain('Late');
    stop();
  });

  it('pins the card and prevents a second result from replacing it', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://a.test">First</a></h3><div class="gs_a">A - 2020</div></div><div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://b.test">Second</a></h3><div class="gs_a">B - 2021</div></div>`;
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? matched('First') : undefined })) } });
    const stop = startContentScript();
    const [first, second] = Array.from(document.querySelectorAll('.gs_r'));
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve();
    const root = document.getElementById('scholar-hover-card')!.shadowRoot!;
    root.querySelector<HTMLButtonElement>('[data-action="pin"]')!.click();
    titleTarget(second).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(root.textContent).toContain('First');
    expect(root.querySelector('[data-action="pin"]')?.getAttribute('aria-pressed')).toBe('true');
    stop();
  });

  it('renders malicious provider data as text instead of markup', async () => {
    vi.useFakeTimers();
    const result = paper();
    const malicious = matched('<img src=x onerror=alert(1)>') as ReturnType<typeof matched>;
    malicious.paper.abstract = '<script>window.pwned=true</script>';
    malicious.paper.sourceUrl = 'javascript:alert(1)';
    stubUncachedRuntime({ runtime: { sendMessage: vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? malicious : undefined })) } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve();
    const root = document.getElementById('scholar-hover-card')!.shadowRoot!;
    expect(root.querySelector('img, script')).toBeNull();
    expect(root.textContent).toContain('<script>window.pwned=true</script>');
    expect(root.querySelector('.source-link')).toBeNull();
    stop();
  });

  it('requires explicit candidate confirmation for ambiguous matches', async () => {
    vi.useFakeTimers();
    const result = paper();
    const ambiguous = { paper: { ...matched().paper, matchStatus: 'unresolved' as const }, candidates: [{ ...matched('Candidate', 'candidate-9').paper, matchStatus: 'unresolved' as const }], warning: '可能存在同名论文' };
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? settings : message.type === 'RESOLVE' ? ambiguous : message.type === 'CONFIRM' ? matched('Confirmed', 'confirmed-9') : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve();
    const root = document.getElementById('scholar-hover-card')!.shadowRoot!;
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'GENERATE')).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-action="confirm"]')!.click(); await Promise.resolve();
    expect(sendMessage.mock.calls.some(([message]) => (message as { type: string; candidateId?: string }).type === 'CONFIRM' && (message as { candidateId?: string }).candidateId === 'candidate-9')).toBe(true);
    stop();
  });

  it('uses cached generation without sending GENERATE', async () => {
    vi.useFakeTimers();
    const result = paper();
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, autoGenerate: true, consent: true, hasApiKey: true } : message.type === 'RESOLVE' ? matched() : message.type === 'GET_CACHED' ? { language: 'zh-CN', titleTranslated: '缓存标题', abstractTranslated: '缓存摘要', summary: '缓存要点', model: 'model-x', fingerprint: 'x', createdAt: 1 } : undefined }));
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    titleTarget(result).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve(); await Promise.resolve();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'GENERATE')).toBe(false);
    const cardText = document.getElementById('scholar-hover-card')!.shadowRoot!.textContent!;
    expect(cardText).toContain('Resolved');
    expect(cardText).toContain('缓存标题');
    stop();
  });

  it('re-subscribes when returning to a paper whose generation is still in flight', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://a.test">First</a></h3><div class="gs_a">A - 2020</div></div><div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://b.test">Second</a></h3><div class="gs_a">B - 2021</div></div>`;
    let finishGeneration!: (value: unknown) => void;
    const sharedGeneration = new Promise(resolve => { finishGeneration = resolve; });
    const sendMessage = vi.fn((message: { type: string; seed?: { title: string }; paperId?: string }) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: { ...settings, autoGenerate: true, consent: true, hasApiKey: true } });
      if (message.type === 'RESOLVE' && message.seed?.title === 'First') return Promise.resolve({ ok: true, data: matched('First', 'paper-a') });
      if (message.type === 'RESOLVE') return Promise.resolve({ ok: true, data: { paper: { ...matched('Second', 'paper-b').paper, matchStatus: 'unresolved' as const }, candidates: [] } });
      if (message.type === 'GET_CACHED') return Promise.resolve({ ok: true, data: undefined });
      if (message.type === 'GENERATE') return sharedGeneration.then(data => ({ ok: true, data }));
      return Promise.resolve({ ok: true, data: undefined });
    });
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    const [first, second] = Array.from(document.querySelectorAll('.gs_r'));
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    titleTarget(second).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve();
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(sendMessage.mock.calls.filter(([message]) => (message as { type: string; paperId?: string }).type === 'GENERATE' && (message as { paperId?: string }).paperId === 'paper-a')).toHaveLength(2);
    finishGeneration({ language: 'zh-CN', titleTranslated: '回到 A 的中文标题', abstractTranslated: null, summary: null, model: 'm', fingerprint: 'f', createdAt: 1 });
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
    expect(document.getElementById('scholar-hover-card')!.shadowRoot!.textContent).toContain('回到 A 的中文标题');
    stop();
  });

  it('does not automatically retry a generation that has failed', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://a.test">First</a></h3><div class="gs_a">A - 2020</div></div><div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://b.test">Second</a></h3><div class="gs_a">B - 2021</div></div>`;
    const sendMessage = vi.fn((message: { type: string; seed?: { title: string } }) => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ok: true, data: { ...settings, autoGenerate: true, consent: true, hasApiKey: true } });
      if (message.type === 'RESOLVE' && message.seed?.title === 'First') return Promise.resolve({ ok: true, data: matched('First', 'paper-a') });
      if (message.type === 'RESOLVE') return Promise.resolve({ ok: true, data: { paper: { ...matched('Second', 'paper-b').paper, matchStatus: 'unresolved' as const }, candidates: [] } });
      if (message.type === 'GET_CACHED') return Promise.resolve({ ok: true, data: undefined });
      if (message.type === 'GENERATE') return Promise.resolve({ ok: false, error: 'provider failure' });
      return Promise.resolve({ ok: true, data: undefined });
    });
    stubUncachedRuntime({ runtime: { sendMessage } });
    const stop = startContentScript();
    const [first, second] = Array.from(document.querySelectorAll('.gs_r'));
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    titleTarget(second).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve();
    titleTarget(first).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); await Promise.resolve(); await Promise.resolve();
    expect(sendMessage.mock.calls.filter(([message]) => (message as { type: string }).type === 'GENERATE')).toHaveLength(1);
    stop();
  });
});
