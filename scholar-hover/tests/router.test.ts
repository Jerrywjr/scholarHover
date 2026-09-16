import { describe, it, expect, vi } from 'vitest';
import { createRouter, type RouterDependencies } from '../src/background/router';
import { createCollectionStore } from '../src/background/collection';
import { previewKey } from '../src/shared/identity';
import type { Generated, Paper, Resolution, SettingsView } from '../src/shared/types';

const seed = { title: 'Evidence and uncertainty', authors: ['A Smith'], year: 2024, url: 'https://example.org/paper' };
const paper: Paper = { ...seed, id: 'W1', source: 'OpenAlex', sourceUrl: 'https://openalex.org/W1', matchStatus: 'matched', abstract: 'No significant increase was observed.' };
const sender = { id: 'ext', tab: { id: 1 }, url: 'https://scholar.google.com/scholar?q=test' } as chrome.runtime.MessageSender;
const options = { id: 'ext', url: 'chrome-extension://ext/options.html' } as chrome.runtime.MessageSender;
const manager = { id: 'ext', url: 'chrome-extension://ext/collection.html' } as chrome.runtime.MessageSender;
function setup() {
  const session: Record<string, unknown> = {};
  let collectionData: unknown;
  const previews = new Map<string, Resolution>();
  const generated = new Map<string, Generated>();
  const settings: SettingsView = { uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', baseUrl: 'https://llm.example/v1', model: 'test', consent: true, rememberKey: false, autoGenerate: true, hasApiKey: true, hasOpenAlexKey: false };
  const deps: RouterDependencies = {
    extensionId: 'ext',
    getSession: async key => session[key], setSession: async (key, value) => { session[key] = value; },
    readSettings: async () => settings, readCredentials: async () => ({ apiKey: 'secret', openAlexKey: '' }),
    saveSettings: async () => settings, clearKeys: async () => {}, clearCache: async () => { previews.clear(); generated.clear(); },
    getPreview: async seed => previews.get(previewKey(seed)), putPreview: async (seed, value) => { previews.set(previewKey(seed), value); },
    resolvePaper: async () => ({ paper, candidates: [] }),
    fingerprint: async p => 'fp:' + p.id,
    getCached: async key => generated.get(key), putCached: async value => { generated.set(value.fingerprint, value); },
    generate: async () => ({ language: 'zh-CN', titleTranslated: '证据与不确定性', abstractTranslated: '未观察到显著增加。', summary: '研究未发现显著增加。', model: 'test', fingerprint: 'fp:W1', createdAt: Date.now() }),
    testConnection: async () => {}, hasPermission: async () => true, openSettings: async () => {},
    openCollection: async () => {},
    collection: createCollectionStore({ read: async () => collectionData, write: async value => { collectionData = structuredClone(value); } }),
    exports: { get: async () => undefined, start: async () => { throw new Error('Unexpected export'); }, retry: async () => { throw new Error('Unexpected retry'); } },
  };
  return { deps, router: createRouter(deps) };
}
describe('worker request boundary', () => {
  it('saves only the same-tab registered paper and never a forged page payload', async () => {
    const { router } = setup();
    expect((await router({ type: 'SAVE_PAPER', paperId: 'W1' }, sender)).ok).toBe(false);
    await router({ type: 'RESOLVE', seed }, sender);
    expect((await router({ type: 'SAVE_PAPER', paperId: 'W1' }, { ...sender, tab: { id: 2 } } as chrome.runtime.MessageSender)).ok).toBe(false);
    expect(await router({ type: 'SAVE_PAPER', paperId: 'W1', paper: { title: 'Forged', downloadUrl: 'file:///secret' } }, sender)).toMatchObject({ ok: true, data: { paper: { title: paper.title } } });
    expect(await router({ type: 'GET_COLLECTION' }, manager)).toMatchObject({ ok: true, data: { items: [{ paper: { title: paper.title } }] } });
  });
  it('limits collection reading, deletion, export and retry to the exact manager page', async () => {
    const { router } = setup();
    for (const type of ['GET_COLLECTION', 'CLEAR_COLLECTION', 'EXPORT_COLLECTION', 'RETRY_DOWNLOAD']) {
      expect((await router({ type, revision: 0 }, sender)).ok).toBe(false);
      expect((await router({ type, revision: 0 }, options)).ok).toBe(false);
      expect((await router({ type, revision: 0 }, { ...manager, url: manager.url + '?fake' })).ok).toBe(false);
    }
    expect((await router({ type: 'CLEAR_KEYS' }, manager)).ok).toBe(false);
    expect((await router({ type: 'CLEAR_COLLECTION', revision: 0 }, manager)).ok).toBe(true);
  });
  it('updates translation only on a saved paper and rejects stale export order', async () => {
    const { router } = setup();
    await router({ type: 'RESOLVE', seed }, sender);
    await router({ type: 'SAVE_PAPER', paperId: 'W1' }, sender);
    await router({ type: 'GENERATE', paperId: 'W1' }, sender);
    expect(await router({ type: 'GET_COLLECTION' }, manager)).toMatchObject({ ok: true, data: { items: [{ generated: { titleTranslated: '证据与不确定性' } }] } });
    expect(await router({ type: 'EXPORT_COLLECTION', revision: 0 }, manager)).toMatchObject({ ok: false, error: '缓存列表已更新，请刷新后重试。' });
  });
  it('returns a successful generation with a separate warning if the saved copy cannot be updated', async () => {
    const { deps, router } = setup();
    await router({ type: 'RESOLVE', seed }, sender);
    deps.collection.updateGenerated = async () => { throw new Error('缓存文章超过 4 MiB 容量，请先删除部分文章。'); };
    expect(await router({ type: 'GENERATE', paperId: 'W1' }, sender)).toMatchObject({ ok: true, data: { titleTranslated: '证据与不确定性', collectionWarning: '缓存文章超过 4 MiB 容量，请先删除部分文章。' } });
    deps.getCached = async () => ({ language: 'zh-CN', titleTranslated: '有效缓存', abstractTranslated: '摘要', summary: '要点', model: 'test', fingerprint: 'fp:W1', createdAt: 1 });
    expect(await router({ type: 'GENERATE', paperId: 'W1' }, sender)).toMatchObject({ ok: true, data: { titleTranslated: '有效缓存', collectionWarning: '缓存文章超过 4 MiB 容量，请先删除部分文章。' } });
  });
  it('does not let an older output language overwrite the currently saved translation', async () => {
    const { deps, router } = setup();
    let settings = { ...await deps.readSettings(), outputLanguage: 'en' as 'en' | 'fr' };
    deps.readSettings = async () => settings;
    deps.saveSettings = async value => { settings = { ...settings, ...value, outputLanguage: value.outputLanguage as 'en' | 'fr' }; return settings; };
    deps.fingerprint = async (_paper, config) => config.outputLanguage;
    let finishOld!: (value: Awaited<ReturnType<RouterDependencies['generate']>>) => void;
    deps.generate = async (_paper, config) => config.outputLanguage === 'en' ? new Promise(resolve => { finishOld = resolve; })
      : { language: 'fr', titleTranslated: 'Nouveau', abstractTranslated: 'Résumé', summary: 'Point', model: 'test', fingerprint: 'fr', createdAt: 2 };
    await router({ type: 'RESOLVE', seed }, sender);
    await router({ type: 'SAVE_PAPER', paperId: 'W1' }, sender);
    const old = router({ type: 'GENERATE', paperId: 'W1' }, sender);
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'));
    await router({ type: 'SAVE_SETTINGS', settings: { ...settings, outputLanguage: 'fr' } }, options);
    await router({ type: 'GENERATE', paperId: 'W1' }, sender);
    finishOld({ language: 'en', titleTranslated: 'Old', abstractTranslated: 'Abstract', summary: 'Point', model: 'test', fingerprint: 'en', createdAt: 1 });
    await old;
    expect(await router({ type: 'GET_COLLECTION' }, manager)).toMatchObject({ ok: true, data: { items: [{ generated: { language: 'fr', titleTranslated: 'Nouveau' } }] } });
  });
  it('keeps a translation completed while saving an earlier cache snapshot', async () => {
    const { deps, router } = setup();
    let cache: Awaited<ReturnType<RouterDependencies['getCached']>>;
    let completeGeneration!: (value: Awaited<ReturnType<RouterDependencies['generate']>>) => void;
    let releaseSave!: (value: undefined) => void;
    let reads = 0;
    deps.getCached = async () => ++reads === 2 ? new Promise(resolve => { releaseSave = resolve; }) : cache;
    deps.putCached = async value => { cache = value; };
    deps.generate = async () => new Promise(resolve => { completeGeneration = resolve; });
    await router({ type: 'RESOLVE', seed }, sender);
    const generation = router({ type: 'GENERATE', paperId: 'W1' }, sender);
    await vi.waitFor(() => expect(completeGeneration).toBeTypeOf('function'));
    const saving = router({ type: 'SAVE_PAPER', paperId: 'W1' }, sender);
    await vi.waitFor(() => expect(releaseSave).toBeTypeOf('function'));
    completeGeneration({ language: 'zh-CN', titleTranslated: '刚完成的译文', abstractTranslated: '摘要', summary: '要点', model: 'test', fingerprint: 'fp:W1', createdAt: 1 });
    await vi.waitFor(() => expect(cache?.titleTranslated).toBe('刚完成的译文'));
    releaseSave(undefined);
    await Promise.all([saving, generation]);
    expect(await router({ type: 'GET_COLLECTION' }, manager)).toMatchObject({ ok: true, data: { items: [{ generated: { titleTranslated: '刚完成的译文' } }] } });
  });
  it('rejects configuration mutations from web content and wrong extension senders', async () => {
    const { router } = setup();
    expect((await router({ type: 'CLEAR_KEYS' }, sender)).ok).toBe(false);
    expect((await router({ type: 'GET_SETTINGS' }, { ...sender, id: 'another' })).ok).toBe(false);
    expect((await router({ type: 'GET_SETTINGS' }, { ...sender, url: 'https://scholar.google.com.evil/scholar' })).ok).toBe(false);
  });
  it('never accepts arbitrary paper text for generation; requires resolution in same tab', async () => {
    const { router } = setup();
    expect((await router({ type: 'GENERATE', paperId: 'W1', abstract: 'fake' }, sender)).ok).toBe(false);
    expect((await router({ type: 'RESOLVE', seed }, sender)).ok).toBe(true);
    expect((await router({ type: 'GENERATE', paperId: 'W1' }, { ...sender, tab: { id: 2 } } as chrome.runtime.MessageSender)).ok).toBe(false);
    const result = await router({ type: 'GENERATE', paperId: 'W1' }, sender);
    expect(result).toMatchObject({ ok: true, data: { language: 'zh-CN', titleTranslated: '证据与不确定性' } });
  });
  it('requires explicit confirmation before using an ambiguous candidate', async () => {
    const { deps, router } = setup();
    deps.resolvePaper = async () => ({ paper: { ...paper, id: 'page', abstract: undefined, matchStatus: 'unresolved' }, candidates: [{ ...paper, matchStatus: 'unresolved' }] });
    await router({ type: 'RESOLVE', seed }, sender);
    expect((await router({ type: 'GENERATE', paperId: 'W1' }, sender)).ok).toBe(false);
    expect(await router({ type: 'CONFIRM', seed, candidateId: 'W1' }, sender)).toMatchObject({ ok: true, data: { paper: { matchStatus: 'confirmed' } } });
    expect((await router({ type: 'GENERATE', paperId: 'W1' }, sender)).ok).toBe(true);
  });
  it('deduplicates concurrent generation and does not retry a failed model', async () => {
    const { deps, router } = setup();
    await router({ type: 'RESOLVE', seed }, sender);
    let calls = 0;
    deps.generate = async () => { calls++; await new Promise(r => setTimeout(r, 15)); throw new Error('模型暂不可用'); };
    const results = await Promise.all([router({ type: 'GENERATE', paperId: 'W1' }, sender), router({ type: 'GENERATE', paperId: 'W1' }, sender)]);
    expect(calls).toBe(1);
    expect(results.every(r => !r.ok)).toBe(true);
  });
  it('honors cached results and blocks model calls without consent or permission', async () => {
    const { deps, router } = setup();
    await router({ type: 'RESOLVE', seed }, sender);
    deps.generate = async () => { throw new Error('must not call'); };
    deps.getCached = async () => ({ language: 'zh-CN', titleTranslated: '缓存', abstractTranslated: '原摘要译文', summary: '概述', model: 'test', fingerprint: 'fp:W1', createdAt: Date.now() });
    expect(await router({ type: 'GENERATE', paperId: 'W1' }, sender)).toMatchObject({ ok: true, data: { language: 'zh-CN', titleTranslated: '缓存' } });
    deps.hasPermission = async () => false;
    expect((await router({ type: 'GENERATE', paperId: 'W1' }, sender)).ok).toBe(true);
    deps.getCached = async () => undefined;
    expect((await router({ type: 'GENERATE', paperId: 'W1' }, sender)).ok).toBe(false);
  });
  it('validates input and only allows exact options page to save settings', async () => {
    const { router } = setup();
    expect((await router({ type: 'RESOLVE', seed: { ...seed, url: 'javascript:alert(1)' } }, sender)).ok).toBe(false);
    expect((await router({ type: 'CLEAR_CACHE' }, options)).ok).toBe(true);
    expect((await router({ type: 'CLEAR_CACHE' }, { ...options, url: 'chrome-extension://ext/other.html' })).ok).toBe(false);
  });
  it('keeps unknown publication version unknown instead of declaring it published', async () => {
    const { deps, router } = setup();
    let seen: unknown;
    deps.resolvePaper = async s => { seen = s.preprint; return { paper, candidates: [] }; };
    await router({ type: 'RESOLVE', seed }, sender);
    expect(seen).toBeUndefined();
  });
  it('does not repopulate cleared cache with a model request already in flight', async () => {
    const { deps, router } = setup();
    await router({ type: 'RESOLVE', seed }, sender);
    let done!: (value: Awaited<ReturnType<RouterDependencies['generate']>>) => void;
    let writes = 0;
    deps.generate = () => new Promise(resolve => { done = resolve; });
    deps.putCached = async () => { writes++; };
    const request = router({ type: 'GENERATE', paperId: 'W1' }, sender);
    await vi.waitFor(() => expect(done).toBeTypeOf('function'));
    await router({ type: 'CLEAR_CACHE' }, options);
    done({ language: 'zh-CN', titleTranslated: '测试', abstractTranslated: null, summary: null, model: 'test', fingerprint: 'fp:W1', createdAt: Date.now() });
    await request;
    expect(writes).toBe(0);
  });
  it('takes a coherent endpoint/key snapshot when settings change during a generation', async () => {
    const { deps, router } = setup();
    await router({ type: 'RESOLVE', seed }, sender);
    let configuration = await deps.readSettings();
    let secret = 'OLD_SECRET';
    let release!: () => void;
    const permissionGate = new Promise<void>(resolve => { release = resolve; });
    let checked = false;
    let sent: unknown;
    deps.readSettings = async () => ({ ...configuration });
    deps.readCredentials = async () => ({ apiKey: secret, openAlexKey: '' });
    deps.hasPermission = async () => { if (!checked) { checked = true; await permissionGate; } return true; };
    deps.saveSettings = async settings => { configuration = { ...settings, hasApiKey: true, hasOpenAlexKey: false }; secret = 'NEW_SECRET'; return configuration; };
    deps.generate = async (_paper, settings, apiKey) => {
      sent = { endpoint: settings.baseUrl, apiKey };
      return { language: 'zh-CN', titleTranslated: '译文', abstractTranslated: '摘要', summary: '概述', model: settings.model, fingerprint: 'fp:W1', createdAt: Date.now() };
    };
    const pending = router({ type: 'GENERATE', paperId: 'W1' }, sender);
    await vi.waitFor(() => expect(checked).toBe(true));
    const saving = router({ type: 'SAVE_SETTINGS', settings: { ...configuration, baseUrl: 'https://new.example/v1' }, apiKey: 'NEW_SECRET' }, options);
    await new Promise(resolve => setTimeout(resolve, 10));
    release();
    await Promise.all([pending, saving]);
    expect(sent).toEqual({ endpoint: 'https://llm.example/v1', apiKey: 'OLD_SECRET' });
  });
});

describe('durable previews and immediate saved completion', () => {
  it('acknowledges an unseen seed before metadata or the model complete, then finishes without a page', async () => {
    const { deps, router } = setup();
    let resolveMetadata!: (value: Resolution) => void;
    let resolveModel!: (value: Generated) => void;
    deps.resolvePaper = vi.fn(() => new Promise<Resolution>(resolve => { resolveMetadata = resolve; }));
    deps.generate = vi.fn(() => new Promise<Generated>(resolve => { resolveModel = resolve; }));
    const saved = await router({ type: 'SAVE_PAPER', seed }, sender);
    expect(saved).toMatchObject({ ok: true, data: { seed, paper: { title: seed.title, source: 'Google Scholar' }, completion: { status: 'queued' } } });
    await vi.waitFor(() => expect(resolveMetadata).toBeTypeOf('function'));
    expect(deps.generate).not.toHaveBeenCalled();
    resolveMetadata({ paper, candidates: [] });
    await vi.waitFor(() => expect(resolveModel).toBeTypeOf('function'));
    resolveModel({ language: 'zh-CN', titleTranslated: '后台生成', abstractTranslated: '原文摘要译文', summary: '要点', model: 'test', fingerprint: 'fp:W1', createdAt: 1 });
    await router.idle();
    const snapshot = await deps.collection.list();
    expect(snapshot.items[0]).toMatchObject({ paper: { id: 'W1' }, generated: { titleTranslated: '后台生成' }, completion: { status: 'ready' } });
    if (saved.ok) expect(snapshot.items[0].id).toBe((saved.data as { id: string }).id);
    expect(await router({ type: 'GET_PREVIEW', seed }, { ...sender, tab: { id: 2 } } as chrome.runtime.MessageSender)).toMatchObject({ ok: true, data: { generated: { titleTranslated: '后台生成' }, saved: { completion: { status: 'ready' } } } });
    expect(deps.resolvePaper).toHaveBeenCalledTimes(1);
    expect(deps.generate).toHaveBeenCalledTimes(1);
  });
  it('restores an unsaved paid preview after worker restart without network or credentials', async () => {
    const { deps, router } = setup();
    await router({ type: 'RESOLVE', seed }, sender);
    await router({ type: 'GENERATE', paperId: paper.id }, sender);
    expect((await deps.collection.list()).items).toHaveLength(0);
    deps.resolvePaper = vi.fn(() => { throw new Error('must not query'); });
    deps.generate = vi.fn(() => { throw new Error('must not pay again'); });
    deps.readCredentials = async () => ({ apiKey: '', openAlexKey: '' });
    deps.hasPermission = async () => false;
    const restarted = createRouter(deps);
    const result = await restarted({ type: 'GET_PREVIEW', seed }, { ...sender, tab: { id: 22 } } as chrome.runtime.MessageSender);
    expect(result).toMatchObject({ ok: true, data: { resolution: { paper }, generated: { titleTranslated: '证据与不确定性' }, saved: undefined } });
    expect(deps.resolvePaper).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it('shares resolution and generation between early saving and an already open preview', async () => {
    const { deps, router } = setup();
    deps.resolvePaper = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 15)); return { paper, candidates: [] }; });
    const generate = deps.generate;
    deps.generate = vi.fn(async (...args: Parameters<RouterDependencies['generate']>) => { await new Promise(resolve => setTimeout(resolve, 20)); return generate(...args); });
    const lookup = router({ type: 'RESOLVE', seed }, sender);
    await router({ type: 'SAVE_PAPER', seed }, sender);
    await lookup;
    await router({ type: 'GENERATE', paperId: paper.id }, sender);
    await router.idle();
    expect(deps.resolvePaper).toHaveBeenCalledTimes(1);
    expect(deps.generate).toHaveBeenCalledTimes(1);
    await router({ type: 'SAVE_PAPER', seed }, sender);
    await router.idle();
    expect((await deps.collection.list()).items).toHaveLength(1);
    expect(deps.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps click order, never starts a deleted queued paper, and never resurrects a deleted running one', async () => {
    const { deps, router } = setup();
    let finish!: (value: Resolution) => void;
    deps.resolvePaper = vi.fn(() => new Promise<Resolution>(resolve => { finish = resolve; }));
    deps.generate = vi.fn(deps.generate);
    await router({ type: 'SAVE_PAPER', seed }, sender);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const second = { ...seed, title: 'Second', url: 'https://example.org/second' };
    await router({ type: 'SAVE_PAPER', seed: second }, sender);
    const saved = await deps.collection.list();
    expect(saved.items.map(item => item.seed?.title)).toEqual([seed.title, 'Second']);
    await deps.collection.clear(saved.revision);
    finish({ paper, candidates: [] });
    await router.idle();
    expect((await deps.collection.list()).items).toHaveLength(0);
    expect(deps.resolvePaper).toHaveBeenCalledTimes(1);
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it('pauses ambiguous candidates until explicit manager confirmation', async () => {
    const { deps, router } = setup();
    deps.resolvePaper = async () => ({ paper: { ...paper, id: 'source', abstract: undefined, matchStatus: 'unresolved' }, candidates: [paper] });
    deps.generate = vi.fn(deps.generate);
    await router({ type: 'SAVE_PAPER', seed }, sender);
    await router.idle();
    const item = (await deps.collection.list()).items[0];
    expect(item.completion?.status).toBe('needs-confirmation');
    expect(deps.generate).not.toHaveBeenCalled();
    expect((await router({ type: 'CONFIRM_SAVED', id: item.id, candidateId: paper.id }, sender)).ok).toBe(false);
    expect((await router({ type: 'CONFIRM_SAVED', id: item.id, candidateId: 'forged' }, manager)).ok).toBe(false);
    expect((await router({ type: 'CONFIRM_SAVED', id: item.id, candidateId: paper.id }, manager)).ok).toBe(true);
    await router.idle();
    expect((await deps.collection.list()).items[0]).toMatchObject({ paper: { id: paper.id, matchStatus: 'confirmed' }, completion: { status: 'ready' } });
    expect(deps.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps saved failures without auto retries and allows an explicit retry', async () => {
    const { deps, router } = setup();
    const success = deps.generate;
    deps.generate = vi.fn(async () => { throw new Error('模型暂不可用'); });
    await router({ type: 'SAVE_PAPER', seed }, sender);
    await router.idle();
    const item = (await deps.collection.list()).items[0];
    expect(item.completion?.status).toBe('failed');
    await router({ type: 'SAVE_PAPER', seed }, sender);
    await router({ type: 'GET_PREVIEW', seed }, sender);
    await router({ type: 'GET_COLLECTION' }, manager);
    await router.idle();
    expect(deps.generate).toHaveBeenCalledTimes(1);
    deps.generate = vi.fn(success);
    await router({ type: 'RETRY_SAVED', id: item.id }, manager);
    await router.idle();
    expect((await deps.collection.list()).items[0].completion?.status).toBe('ready');
    expect(deps.generate).toHaveBeenCalledTimes(1);
  });
  it('saves with absent credentials and resumes only on user retry after configuration', async () => {
    const { deps, router } = setup();
    deps.readCredentials = async () => ({ apiKey: '', openAlexKey: '' });
    deps.generate = vi.fn(deps.generate);
    await router({ type: 'SAVE_PAPER', seed }, sender);
    await router.idle();
    const item = (await deps.collection.list()).items[0];
    expect(item).toMatchObject({ paper: { id: paper.id }, completion: { status: 'needs-configuration' } });
    expect(deps.generate).not.toHaveBeenCalled();
    deps.readCredentials = async () => ({ apiKey: 'new-key', openAlexKey: '' });
    await router({ type: 'RETRY_SAVED', id: item.id }, manager);
    await router.idle();
    expect((await deps.collection.list()).items[0].completion?.status).toBe('ready');
  });
  it('recovers queued work, but never automatically repeats interrupted paid calls', async () => {
    const { deps } = setup();
    const pending = await deps.collection.save(paper, undefined, { seed, completion: { status: 'generating', updatedAt: 1 } });
    await deps.collection.save({ ...paper, id: 'W2' }, undefined, { seed: { ...seed, title: 'Second' }, completion: { status: 'queued', updatedAt: 1 } });
    deps.generate = vi.fn(async (value: Paper): Promise<Generated> => ({ language: 'zh-CN', titleTranslated: '恢复队列', abstractTranslated: null, summary: null, model: 'test', fingerprint: 'fp:' + value.id, createdAt: 1 }));
    const restarted = createRouter(deps);
    await restarted.resume();
    await restarted.idle();
    const items = (await deps.collection.list()).items;
    expect(items.find(item => item.id === pending.id)?.completion?.status).toBe('interrupted');
    expect(items[1].completion?.status).toBe('ready');
    expect(deps.generate).toHaveBeenCalledTimes(1);
    await restarted.resume();
    await restarted.idle();
    expect(deps.generate).toHaveBeenCalledTimes(1);
  });
  it('retains valid generated output on archive write failure and avoids charging again in this worker', async () => {
    const { deps, router } = setup();
    deps.putCached = async () => { throw new Error('Quota exceeded'); };
    deps.generate = vi.fn(deps.generate);
    await router({ type: 'RESOLVE', seed }, sender);
    expect(await router({ type: 'GENERATE', paperId: paper.id }, sender)).toMatchObject({ ok: true, data: { titleTranslated: '证据与不确定性', cacheWarning: expect.any(String) } });
    expect(await router({ type: 'GET_PREVIEW', seed }, sender)).toMatchObject({ ok: true, data: { generated: { titleTranslated: '证据与不确定性', cacheWarning: expect.any(String) } } });
    await router({ type: 'GENERATE', paperId: paper.id }, sender);
    expect(deps.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps explicitly saved translations available after preview-cache clearing', async () => {
    const { deps, router } = setup();
    await router({ type: 'SAVE_PAPER', seed }, sender);
    await router.idle();
    await router({ type: 'CLEAR_CACHE' }, options);
    deps.generate = vi.fn(deps.generate);
    const restarted = createRouter(deps);
    expect(await restarted({ type: 'GET_PREVIEW', seed }, sender)).toMatchObject({ ok: true, data: { generated: { titleTranslated: '证据与不确定性' }, saved: { completion: { status: 'ready' } } } });
    await restarted({ type: 'GENERATE', paperId: paper.id }, sender);
    expect(deps.generate).not.toHaveBeenCalled();
  });
});

it('persists an unseen seed even when archive reading is unavailable', async () => {
  const { deps, router } = setup();
  deps.getPreview = async () => { throw new Error('无法读取本地归档，请重试；现有数据未删除。'); };
  expect(await router({ type: 'SAVE_PAPER', seed }, sender)).toMatchObject({ ok: true, data: { seed, completion: { status: 'queued' } } });
  await router.idle();
  expect((await deps.collection.list()).items[0]).toMatchObject({ seed, completion: { status: 'failed' } });
});

it('keeps obsolete generated output archived without marking an empty saved translation ready', async () => {
  const { deps, router } = setup();
  let config = { ...await deps.readSettings(), outputLanguage: 'en' as 'en' | 'fr' };
  deps.readSettings = async () => config;
  deps.saveSettings = async settings => config = { ...config, ...settings, outputLanguage: settings.outputLanguage as 'en' | 'fr' };
  deps.fingerprint = async (_paper, settings) => settings.outputLanguage;
  let done!: (value: Generated) => void;
  deps.generate = vi.fn(() => new Promise<Generated>(resolve => { done = resolve; }));
  await router({ type: 'SAVE_PAPER', seed }, sender);
  await vi.waitFor(() => expect(done).toBeTypeOf('function'));
  await router({ type: 'SAVE_SETTINGS', settings: { ...config, outputLanguage: 'fr' } }, options);
  done({ language: 'en', titleTranslated: 'English', abstractTranslated: 'Abstract', summary: 'Summary', model: 'test', fingerprint: 'en', createdAt: 1 });
  await router.idle();
  expect((await deps.collection.list()).items[0]).toMatchObject({ completion: { status: 'needs-configuration' }, generated: undefined });
  expect(await deps.getCached('en')).toMatchObject({ titleTranslated: 'English' });
});

it('guards cache-hit completion against a concurrent output-language change', async () => {
  const { deps, router } = setup();
  let config = { ...await deps.readSettings(), outputLanguage: 'en' as 'en' | 'fr' };
  deps.readSettings = async () => config;
  deps.saveSettings = async settings => config = { ...config, ...settings, outputLanguage: settings.outputLanguage as 'en' | 'fr' };
  deps.fingerprint = async (_paper, settings) => settings.outputLanguage;
  let release!: (value: Generated) => void;
  const read = deps.getCached;
  deps.getCached = async fingerprint => fingerprint === 'en' ? new Promise<Generated>(resolve => { release = resolve; }) : read(fingerprint);
  deps.generate = async () => ({ language: 'fr', titleTranslated: 'Français', abstractTranslated: 'Résumé', summary: 'Point', model: 'test', fingerprint: 'fr', createdAt: 2 });
  await router({ type: 'SAVE_PAPER', seed }, sender);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await router({ type: 'SAVE_SETTINGS', settings: { ...config, outputLanguage: 'fr' } }, options);
  await router({ type: 'GET_PREVIEW', seed }, sender);
  await router({ type: 'GENERATE', paperId: paper.id }, sender);
  release({ language: 'en', titleTranslated: 'Old English', abstractTranslated: 'Old', summary: 'Old', model: 'test', fingerprint: 'en', createdAt: 1 });
  await router.idle();
  expect((await deps.collection.list()).items[0]).toMatchObject({ completion: { status: 'ready' }, generated: { language: 'fr', titleTranslated: 'Français' } });
});

it('recovers an already saved paid result without charging again after a mid-commit worker restart', async () => {
  const { deps } = setup();
  const output = await deps.generate(paper, await deps.readSettings(), 'test');
  await deps.collection.save(paper, output, { completion: { status: 'generating', updatedAt: 1 }, seed });
  deps.generate = vi.fn(deps.generate);
  const restarted = createRouter(deps);
  await restarted.resume();
  await restarted.idle();
  expect((await deps.collection.list()).items[0]).toMatchObject({ completion: { status: 'ready' }, generated: output });
  expect(deps.generate).not.toHaveBeenCalled();
});

it('uses a saved current translation even when IndexedDB becomes unreadable after restart', async () => {
  const { deps, router } = setup();
  await router({ type: 'SAVE_PAPER', seed }, sender);
  await router.idle();
  deps.getPreview = async () => { throw new Error('Archive unavailable'); };
  deps.getCached = async () => { throw new Error('Archive unavailable'); };
  deps.generate = vi.fn(deps.generate);
  const restarted = createRouter(deps);
  expect(await restarted({ type: 'GET_PREVIEW', seed }, sender)).toMatchObject({ ok: true, data: { generated: { titleTranslated: '证据与不确定性' } } });
  expect(await restarted({ type: 'GET_CACHED', paperId: paper.id }, sender)).toMatchObject({ ok: true, data: { titleTranslated: '证据与不确定性' } });
  await restarted({ type: 'GENERATE', paperId: paper.id }, sender);
  expect(deps.generate).not.toHaveBeenCalled();
});

it('does not let an older failed request cancel completion for a newly confirmed paper', async () => {
  const { deps, router } = setup();
  let rejectOld!: (error: Error) => void;
  const nextPaper = { ...paper, id: 'W2', title: 'New confirmed paper', matchStatus: 'confirmed' as const };
  deps.generate = vi.fn(async (value: Paper): Promise<Generated> => value.id === paper.id
    ? new Promise<Generated>((_resolve, reject) => { rejectOld = reject; })
    : { language: 'zh-CN', titleTranslated: '新确认的论文', abstractTranslated: '摘要', summary: '概述', model: 'test', fingerprint: 'fp:W2', createdAt: 2 });
  await router({ type: 'SAVE_PAPER', seed }, sender);
  await vi.waitFor(() => expect(rejectOld).toBeTypeOf('function'));
  const item = (await deps.collection.list()).items[0];
  await deps.collection.update(item.id, item.savedAt, { paper: nextPaper, completion: { status: 'queued', updatedAt: Date.now() + 1 } });
  rejectOld(new Error('Old request failed'));
  await router.idle();
  expect((await deps.collection.list()).items[0]).toMatchObject({ paper: { id: 'W2' }, generated: { titleTranslated: '新确认的论文' }, completion: { status: 'ready' } });
  expect(deps.generate).toHaveBeenCalledTimes(2);
});

it('restores result badges from local state without resolving or generating any paper', async () => {
  const { deps, router } = setup();
  const seen = { ...seed, title: 'Only viewed', url: 'https://example.org/viewed' };
  const unseen = { ...seed, title: 'New paper', url: 'https://example.org/new' };
  await deps.putPreview(seen, { paper: { ...paper, id: 'W2' }, candidates: [] });
  await deps.collection.save(paper, undefined, { seed, sourceKey: previewKey(seed) });
  deps.resolvePaper = vi.fn(deps.resolvePaper); deps.generate = vi.fn(deps.generate);
  expect(await router({ type: 'GET_PREVIEW_STATES', seeds: [seed, seen, unseen] }, sender)).toEqual({ ok: true, data: ['saved', 'viewed', 'unviewed'] });
  expect(deps.resolvePaper).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled();
  expect((await router({ type: 'GET_PREVIEW_STATES', seeds: Array(101).fill(seed) }, sender)).ok).toBe(false);
  expect((await router({ type: 'GET_PREVIEW_STATES', seeds: [seed] }, manager)).ok).toBe(false);
  deps.getPreview = async () => { throw new Error('Archive unavailable'); };
  expect(await router({ type: 'GET_PREVIEW_STATES', seeds: [seed, unseen] }, sender)).toEqual({ ok: true, data: ['saved', 'unknown'] });
});
