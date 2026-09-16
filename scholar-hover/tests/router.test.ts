import { describe, it, expect, vi } from 'vitest';
import { createRouter, type RouterDependencies } from '../src/background/router';
import { createCollectionStore } from '../src/background/collection';
import type { Paper, SettingsView } from '../src/shared/types';

const seed = { title: 'Evidence and uncertainty', authors: ['A Smith'], year: 2024, url: 'https://example.org/paper' };
const paper: Paper = { ...seed, id: 'W1', source: 'OpenAlex', sourceUrl: 'https://openalex.org/W1', matchStatus: 'matched', abstract: 'No significant increase was observed.' };
const sender = { id: 'ext', tab: { id: 1 }, url: 'https://scholar.google.com/scholar?q=test' } as chrome.runtime.MessageSender;
const options = { id: 'ext', url: 'chrome-extension://ext/options.html' } as chrome.runtime.MessageSender;
const manager = { id: 'ext', url: 'chrome-extension://ext/collection.html' } as chrome.runtime.MessageSender;
function setup() {
  const session: Record<string, unknown> = {};
  let collectionData: unknown;
  const settings: SettingsView = { uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', baseUrl: 'https://llm.example/v1', model: 'test', consent: true, rememberKey: false, autoGenerate: true, hasApiKey: true, hasOpenAlexKey: false };
  const deps: RouterDependencies = {
    extensionId: 'ext',
    getSession: async key => session[key], setSession: async (key, value) => { session[key] = value; },
    readSettings: async () => settings, readCredentials: async () => ({ apiKey: 'secret', openAlexKey: '' }),
    saveSettings: async () => settings, clearKeys: async () => {}, clearCache: async () => {},
    resolvePaper: async () => ({ paper, candidates: [] }),
    fingerprint: async p => 'fp:' + p.id,
    getCached: async () => undefined, putCached: async () => {},
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
