import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CollectionSnapshot, ExportBatch, Request, SavedPaper } from '../src/shared/types.ts';
import { startCollectionPage } from '../src/collection/index.ts';

function paper(id: string, title = `Paper ${id}`): SavedPaper {
  return { id, savedAt: 1, updatedAt: 1, paper: { id, title, authors: ['Alice Example'], year: 2024, venue: 'Journal A', abstract: 'An original abstract.', url: `https://example.org/${id}`, sourceUrl: `https://openalex.org/${id}`, source: 'OpenAlex', matchStatus: 'matched' } };
}
const initial = (): CollectionSnapshot => ({ revision: 2, items: [paper('a'), paper('b'), paper('c')] });
const batch = (): ExportBatch => ({ id: 'batch-1', createdAt: 1, folder: 'collection', markdown: { filename: 'collection/papers.md', state: 'complete' }, items: [{ id: 'a', number: 1, title: 'Paper a', filename: 'collection/1 Paper a.pdf', pageUrl: 'https://example.org/a', state: 'downloading' }] });
const flush = async () => { for (let step = 0; step < 20; step++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let stop: (() => void) | undefined;
function fixture(extra?: (request: Request) => unknown, uiLanguage = 'zh-CN') {
  document.documentElement.innerHTML = new DOMParser().parseFromString(readFileSync('collection.html', 'utf8'), 'text/html').documentElement.innerHTML;
  let stored = initial();
  const send = vi.fn(async (request: Request) => {
    const override = extra?.(request);
    const response = (override !== undefined ? await override : { ok: true, data: request.type === 'GET_SETTINGS' ? { uiLanguage } : request.type === 'GET_COLLECTION' ? stored : undefined }) as { ok: boolean; data?: CollectionSnapshot };
    if (response.ok && response.data && Array.isArray(response.data.items) && typeof response.data.revision === 'number') stored = structuredClone(response.data);
    return response;
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
  stop = startCollectionPage();
  return send;
}
function button(action: string, id?: string) {
  return document.querySelector<HTMLButtonElement>(`${id ? `[data-paper-id="${id}"] ` : ''}[data-action="${action}"]`)!;
}
function order() { return Array.from(document.querySelectorAll<HTMLElement>('#paper-list > li')).map(element => element.dataset.paperId); }
afterEach(() => { stop?.(); stop = undefined; document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('collection manager', () => {
  it('polls saved-paper progress until ready and updates open details without losing preview position', async () => {
    vi.useFakeTimers();
    const saved = paper('a'); saved.completion = { status: 'queued', updatedAt: 1 };
    let reads = 0;
    const send = fixture(request => {
      if (request.type !== 'GET_COLLECTION') return;
      const next = structuredClone(saved);
      if (++reads === 2) next.completion!.status = 'generating';
      if (reads >= 3) { next.completion!.status = 'ready'; next.paper.abstract = 'The completed abstract.'; }
      return { ok: true, data: { revision: reads, items: [next] } };
    }); await flush();
    expect(document.querySelector('[data-paper-id="a"] [data-completion]')?.textContent).toContain('等待补全');
    document.querySelector<HTMLDetailsElement>('[data-paper-id="a"] details')!.open = true;
    const preview = document.querySelector<HTMLTextAreaElement>('#markdown-preview')!;
    preview.scrollTop = 130; preview.setSelectionRange(3, 8);
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelector('[data-paper-id="a"] [data-completion]')?.textContent).toContain('正在生成');
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelector('[data-paper-id="a"]')?.textContent).toContain('The completed abstract.');
    expect(document.querySelector<HTMLDetailsElement>('[data-paper-id="a"] details')!.open).toBe(true);
    expect(preview.scrollTop).toBe(130); expect(preview.selectionStart).toBe(3);
    const count = send.mock.calls.filter(([request]) => request.type === 'GET_COLLECTION').length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(send.mock.calls.filter(([request]) => request.type === 'GET_COLLECTION')).toHaveLength(count);
  });

  it('pauses completion polling in a hidden page and refreshes when visible again', async () => {
    vi.useFakeTimers();
    const saved = paper('a'); saved.completion = { status: 'resolving', updatedAt: 1 };
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const send = fixture(request => request.type === 'GET_COLLECTION' ? { ok: true, data: { revision: 1, items: [saved] } } : undefined); await flush();
    hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(send.mock.calls.filter(([request]) => request.type === 'GET_COLLECTION')).toHaveLength(1);
    hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); await flush();
    await vi.advanceTimersByTimeAsync(1100);
    expect(send.mock.calls.filter(([request]) => request.type === 'GET_COLLECTION').length).toBeGreaterThan(2);
  });

  it('defers an in-flight completion update until dragging ends', async () => {
    vi.useFakeTimers();
    const oldRead = deferred<unknown>(); let reads = 0;
    const saved = paper('a'); saved.completion = { status: 'generating', updatedAt: 1 };
    const finished = paper('a', 'Completed paper'); finished.completion = { status: 'ready', updatedAt: 2 };
    fixture(request => request.type === 'GET_COLLECTION' ? ++reads === 1 ? { ok: true, data: { revision: 1, items: [saved] } } : reads === 2 ? oldRead.promise : { ok: true, data: { revision: 2, items: [finished] } } : undefined); await flush();
    await vi.advanceTimersByTimeAsync(1100);
    const row = document.querySelector('[data-paper-id="a"]');
    button('drag', 'a').dispatchEvent(new Event('dragstart', { bubbles: true }));
    oldRead.resolve({ ok: true, data: { revision: 2, items: [finished] } }); await flush();
    expect(document.querySelector('[data-paper-id="a"]')).toBe(row);
    expect(row?.textContent).not.toContain('Completed paper');
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads).toBe(2);
    document.querySelector('#paper-list')!.dispatchEvent(new Event('dragend', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelector('[data-paper-id="a"]')?.textContent).toContain('Completed paper');
  });

  it.each(['failed', 'interrupted', 'needs-configuration'] as const)('retries %s completion explicitly and reloads the collection revision', async completionStatus => {
    const saved = paper('a'); saved.completion = { status: completionStatus, updatedAt: 1, error: '请先配置模型服务。' };
    let retried = false;
    const send = fixture(request => {
      if (request.type === 'GET_COLLECTION') return { ok: true, data: { revision: retried ? 9 : 1, items: [{ ...saved, completion: { status: retried ? 'queued' : completionStatus, updatedAt: 1 } }] } };
      if (request.type === 'RETRY_SAVED') { retried = true; return { ok: true, data: saved }; }
      if (request.type === 'REMOVE_SAVED') return { ok: true, data: { revision: 10, items: [] } };
    }); await flush();
    expect(send.mock.calls.some(([request]) => request.type === 'RETRY_SAVED')).toBe(false);
    if (completionStatus === 'needs-configuration') expect(document.querySelector<HTMLAnchorElement>('[data-paper-id="a"] .completion-settings')?.getAttribute('href')).toBe('options.html');
    button('retry-saved', 'a').click(); await flush();
    expect(send.mock.calls).toContainEqual([{ type: 'RETRY_SAVED', id: 'a' }]);
    expect(document.querySelector('[data-paper-id="a"] [data-completion]')?.textContent).toContain('等待补全');
    button('remove', 'a').click(); await flush();
    expect(send.mock.calls).toContainEqual([{ type: 'REMOVE_SAVED', id: 'a', revision: 9 }]);
  });

  it('shows disambiguation candidates and confirms only the chosen saved-paper match', async () => {
    const saved = paper('a'); saved.completion = { status: 'needs-confirmation', updatedAt: 1 };
    saved.candidates = [{ ...paper('candidate').paper, title: 'Candidate original', year: 2023, venue: 'Candidate Journal' }];
    let confirmed = false;
    const send = fixture(request => {
      if (request.type === 'GET_COLLECTION') return { ok: true, data: { revision: confirmed ? 2 : 1, items: [confirmed ? { ...saved, completion: { status: 'generating', updatedAt: 2 }, candidates: [] } : saved] } };
      if (request.type === 'CONFIRM_SAVED') { confirmed = true; return { ok: true, data: saved }; }
    }); await flush();
    const candidate = document.querySelector('[data-candidate-id="candidate"]');
    expect(candidate?.textContent).toContain('Candidate original');
    expect(candidate?.textContent).toContain('Candidate Journal');
    button('confirm-saved', 'a').click(); await flush();
    expect(send.mock.calls).toContainEqual([{ type: 'CONFIRM_SAVED', id: 'a', candidateId: 'candidate' }]);
    expect(document.querySelector('[data-candidate-id]')).toBeNull();
    expect(document.querySelector('[data-paper-id="a"] [data-completion]')?.textContent).toContain('正在生成');
  });

  it('allows an incomplete export with a persistent notice about the available fields', async () => {
    const saved = paper('a'); saved.completion = { status: 'needs-confirmation', updatedAt: 1 };
    const send = fixture(request => request.type === 'GET_COLLECTION' ? { ok: true, data: { revision: 1, items: [saved] } } : request.type === 'EXPORT_COLLECTION' ? { ok: true, data: batch() } : undefined); await flush();
    expect(document.querySelector('#completion-export-notice')?.textContent).toContain('仅包含导出时已有的信息');
    expect(button('export').disabled).toBe(false);
    button('export').click(); await flush();
    expect(send.mock.calls).toContainEqual([{ type: 'EXPORT_COLLECTION', revision: 1 }]);
    expect(document.querySelector('#completion-export-notice')?.textContent).toContain('仅包含导出时已有的信息');
  });

  it('discards an older completion poll after a mutation and keeps the reloaded order', async () => {
    vi.useFakeTimers();
    const oldRead = deferred<unknown>(); let reads = 0;
    const pending = paper('a'); pending.completion = { status: 'generating', updatedAt: 1 };
    fixture(request => {
      if (request.type === 'GET_COLLECTION') return ++reads === 1 ? { ok: true, data: { revision: 1, items: [pending, paper('b')] } } : reads === 2 ? oldRead.promise : { ok: true, data: { revision: 3, items: [paper('b')] } };
      if (request.type === 'REMOVE_SAVED') return { ok: true, data: { revision: 2, items: [paper('b')] } };
    }); await flush();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads).toBe(2);
    button('remove', 'a').click(); await flush();
    expect(order()).toEqual(['b']);
    oldRead.resolve({ ok: true, data: { revision: 2, items: [pending, paper('b')] } }); await flush();
    expect(order()).toEqual(['b']);
  });

  it.each([['zh-CN', '下载缓存文章'], ['en', 'Download saved papers'], ['fr', 'Télécharger les articles'], ['de', 'Gespeicherte Artikel herunterladen']])('loads the list and export controls in %s', async (language, label) => {
    fixture(undefined, language); await flush();
    expect(document.documentElement.lang).toBe(language);
    expect(button('export').textContent).toBe(label);
    expect(order()).toEqual(['a', 'b', 'c']);
    expect((document.querySelector('#markdown-preview') as HTMLTextAreaElement).readOnly).toBe(true);
    expect((document.querySelector('#markdown-preview') as HTMLTextAreaElement).value).toContain('Paper a');
  });

  it('renders unsafe provider strings as text and rejects executable source URLs', async () => {
    const unsafe = paper('a', '<img src=x onerror=alert(1)>');
    unsafe.paper.url = 'javascript:alert(1)'; unsafe.paper.sourceUrl = 'data:text/html,danger';
    unsafe.paper.abstract = '<script>alert(1)</script>';
    fixture(request => request.type === 'GET_COLLECTION' ? { ok: true, data: { revision: 1, items: [unsafe] } } : undefined); await flush();
    expect(document.querySelector('#paper-list img, #paper-list script')).toBeNull();
    expect(document.querySelector('#paper-list')?.textContent).toContain('<script>alert(1)</script>');
    expect(document.querySelector('#paper-list a')).toBeNull();
  });

  it('reorders accessibly with the current revision, blocks duplicate clicks and preserves open details', async () => {
    const response = deferred<unknown>();
    const send = fixture(request => request.type === 'REORDER_SAVED' ? response.promise : undefined); await flush();
    document.querySelector<HTMLDetailsElement>('[data-paper-id="b"] details')!.open = true;
    button('up', 'b').focus(); button('up', 'b').click(); button('up', 'b').click(); await flush();
    expect(send.mock.calls.filter(([request]) => request.type === 'REORDER_SAVED')).toEqual([[{ type: 'REORDER_SAVED', ids: ['b', 'a', 'c'], revision: 2 }]]);
    expect(button('export').disabled).toBe(true);
    response.resolve({ ok: true, data: { revision: 3, items: [paper('b'), paper('a'), paper('c')] } }); await flush();
    expect(order()).toEqual(['b', 'a', 'c']);
    expect(document.querySelector<HTMLDetailsElement>('[data-paper-id="b"] details')!.open).toBe(true);
    expect(button('export').disabled).toBe(false);
  });

  it('supports internal handle drag reordering and ignores external drag data', async () => {
    const send = fixture(request => request.type === 'REORDER_SAVED' ? { ok: true, data: { revision: 3, items: [paper('c'), paper('a'), paper('b')] } } : undefined); await flush();
    const drag = new Event('dragstart', { bubbles: true });
    Object.defineProperty(drag, 'dataTransfer', { value: { setData: vi.fn(), effectAllowed: '' } });
    button('drag', 'c').dispatchEvent(drag);
    document.querySelector('[data-paper-id="a"]')!.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })); await flush();
    expect(send.mock.calls).toContainEqual([{ type: 'REORDER_SAVED', ids: ['c', 'a', 'b'], revision: 2 }]);
    document.querySelector('[data-paper-id="b"]')!.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })); await flush();
    expect(send.mock.calls.filter(([request]) => request.type === 'REORDER_SAVED')).toHaveLength(1);
  });

  it('reloads the latest collection after a stale removal instead of replaying the mutation', async () => {
    let reads = 0;
    const send = fixture(request => {
      if (request.type === 'GET_COLLECTION') return { ok: true, data: ++reads === 1 ? initial() : { revision: 4, items: [paper('b')] } };
      if (request.type === 'REMOVE_SAVED') return { ok: false, error: '缓存列表已更新，请刷新后重试。' };
    }); await flush();
    button('remove', 'a').click(); await flush();
    expect(order()).toEqual(['b']);
    expect(send.mock.calls.filter(([request]) => request.type === 'REMOVE_SAVED')).toEqual([[{ type: 'REMOVE_SAVED', id: 'a', revision: 2 }]]);
    expect(document.querySelector('#collection-status')?.getAttribute('data-state')).toBe('error');
    expect(button('export').disabled).toBe(false);
  });

  it('requires confirmation before starting a new collection', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const send = fixture(request => request.type === 'CLEAR_COLLECTION' ? { ok: true, data: { revision: 3, items: [] } } : undefined); await flush();
    button('clear').click(); await flush();
    expect(send.mock.calls.some(([request]) => request.type === 'CLEAR_COLLECTION')).toBe(false);
    confirm.mockReturnValue(true); button('clear').click(); await flush();
    expect(send.mock.calls).toContainEqual([{ type: 'CLEAR_COLLECTION', revision: 2 }]);
    expect(order()).toEqual([]); expect(button('export').disabled).toBe(true);
  });

  it('shows actual export progress and polls only until the download becomes terminal', async () => {
    vi.useFakeTimers();
    let exported = false;
    const send = fixture(request => {
      if (request.type === 'EXPORT_COLLECTION') { exported = true; return { ok: true, data: batch() }; }
      if (request.type === 'GET_EXPORT' && exported) return { ok: true, data: { ...batch(), items: [{ ...batch().items[0], state: 'complete' }] } };
    }); await flush();
    button('export').click(); await flush();
    expect(send.mock.calls).toContainEqual([{ type: 'EXPORT_COLLECTION', revision: 2 }]);
    expect(document.querySelector('[data-download-id="a"]')?.textContent).toContain('正在下载');
    expect(button('export').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1600);
    expect(document.querySelector('[data-download-id="a"]')?.textContent).toContain('已完成');
    expect(button('export').disabled).toBe(false);
    const count = send.mock.calls.filter(([request]) => request.type === 'GET_EXPORT').length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(send.mock.calls.filter(([request]) => request.type === 'GET_EXPORT')).toHaveLength(count);
  });

  it('shows failed full text with the source page and retries only on a user click', async () => {
    const failed: ExportBatch = { ...batch(), items: [{ ...batch().items[0], state: 'failed', error: '未找到可下载的原文 PDF。', authOpened: true }] };
    const send = fixture(request => request.type === 'GET_EXPORT' ? { ok: true, data: failed } : request.type === 'RETRY_DOWNLOAD' ? { ok: true, data: batch() } : undefined); await flush();
    expect(document.querySelector('[data-download-id="a"]')?.textContent).toContain('下载失败');
    expect(document.querySelector<HTMLAnchorElement>('[data-download-id="a"] a')?.href).toBe('https://example.org/a');
    expect(send.mock.calls.some(([request]) => request.type === 'RETRY_DOWNLOAD')).toBe(false);
    button('retry').click(); await flush();
    expect(send.mock.calls).toContainEqual([{ type: 'RETRY_DOWNLOAD', batchId: 'batch-1', itemId: 'a' }]);
    expect(document.querySelector('[data-download-id="a"]')?.textContent).toContain('正在下载');
  });

  it('does not let a poll started before retry restore an obsolete failure', async () => {
    vi.useFakeTimers();
    const oldPoll = deferred<unknown>();
    const failed: ExportBatch = { ...batch(), markdown: { ...batch().markdown, state: 'downloading' }, items: [{ ...batch().items[0], state: 'failed' }] };
    let reads = 0;
    fixture(request => {
      if (request.type === 'GET_EXPORT') return ++reads === 1 ? { ok: true, data: failed } : oldPoll.promise;
      if (request.type === 'RETRY_DOWNLOAD') return { ok: true, data: batch() };
    }); await flush();
    await vi.advanceTimersByTimeAsync(1600);
    button('retry').click(); await flush();
    oldPoll.resolve({ ok: true, data: failed }); await flush();
    expect(document.querySelector('[data-download-id="a"]')?.textContent).toContain('正在下载');
    expect(document.querySelector('[data-download-id="a"] [data-action="retry"]')).toBeNull();
  });

  it('leaves existing preview and open details intact during an unchanged focus refresh', async () => {
    fixture(); await flush();
    const detail = document.querySelector<HTMLDetailsElement>('[data-paper-id="a"] details')!;
    detail.open = true;
    const preview = document.querySelector<HTMLTextAreaElement>('#markdown-preview')!;
    preview.focus(); preview.setSelectionRange(10, 22); preview.scrollTop = 140;
    window.dispatchEvent(new Event('focus')); await flush();
    expect(document.querySelector('[data-paper-id="a"] details')).toBe(detail);
    expect(detail.open).toBe(true); expect(preview.selectionStart).toBe(10); expect(preview.scrollTop).toBe(140);
  });
});
