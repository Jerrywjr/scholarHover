import { describe, it, expect, vi } from 'vitest';
import { createRouter, type RouterDependencies } from '../src/background/router';
import type { Paper, SettingsView } from '../src/shared/types';

const seed = { title: 'Evidence and uncertainty', authors: ['A Smith'], year: 2024, url: 'https://example.org/paper' };
const paper: Paper = { ...seed, id: 'W1', source: 'OpenAlex', sourceUrl: 'https://openalex.org/W1', matchStatus: 'matched', abstract: 'No significant increase was observed.' };
const sender = { id: 'ext', tab: { id: 1 }, url: 'https://scholar.google.com/scholar?q=test' } as chrome.runtime.MessageSender;
const options = { id: 'ext', url: 'chrome-extension://ext/options.html' } as chrome.runtime.MessageSender;
function setup() {
  const session: Record<string, unknown> = {};
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
  };
  return { deps, router: createRouter(deps) };
}
describe('worker request boundary', () => {
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
