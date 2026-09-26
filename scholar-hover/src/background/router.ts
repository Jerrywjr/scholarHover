import type { Credentials, Generated, HoverState, Paper, PaperSeed, Resolution, Response, SavedPaper, Settings, SettingsView } from '../shared/types';
import type { createCollectionStore } from './collection';
import type { createExportManager } from './downloads';
import { previewKey } from '../shared/identity';
import { createCompletionQueue } from './completion';
import { unresolvedPaper } from './metadata';
import { normalizeSourceUrl } from '../shared/source-page';

export interface RouterDependencies {
  extensionId: string;
  getHoverState?(): Promise<HoverState>;
  setHoverEnabled?(enabled: boolean): Promise<HoverState>;
  getSession(key: string): Promise<unknown>;
  setSession(key: string, value: unknown): Promise<void>;
  readSettings(): Promise<SettingsView>;
  readCredentials(): Promise<Credentials>;
  saveSettings(settings: Settings, keys?: { apiKey?: string; openAlexKey?: string }): Promise<SettingsView>;
  clearKeys(): Promise<void>;
  clearCache(): Promise<void>;
  getPreview(seed: PaperSeed): Promise<Resolution | undefined>;
  putPreview(seed: PaperSeed, resolution: Resolution): Promise<void>;
  resolvePaper(seed: PaperSeed, openAlexKey?: string): Promise<Resolution>;
  fingerprint(paper: Paper, settings: Settings): Promise<string>;
  getCached(fingerprint: string): Promise<Generated | undefined>;
  putCached(value: Generated): Promise<void>;
  generate(paper: Paper, settings: Settings, apiKey: string): Promise<Generated>;
  testConnection(settings: Settings, apiKey: string): Promise<void>;
  hasPermission(origin: string): Promise<boolean>;
  openSettings(): Promise<void>;
  openCollection(): Promise<void>;
  openSourceAccess?(url: string): Promise<void>;
  collection: ReturnType<typeof createCollectionStore>;
  exports: ReturnType<typeof createExportManager>;
}
interface Entry { key: string; tab: number; resolution: Resolution; at: number }
function parseSeed(input: unknown): PaperSeed {
  const seed = input as PaperSeed;
  if (!seed || typeof seed.title !== 'string' || !seed.title.trim() || seed.title.length > 2000 ||
      !Array.isArray(seed.authors) || seed.authors.length > 100 || seed.authors.some(a => typeof a !== 'string' || a.length > 200)) {
    throw new Error('论文信息格式不正确，请刷新搜索结果。');
  }
  const url = new URL(seed.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seed.url.length > 4000) throw new Error('论文链接无效。');
  if (seed.year !== undefined && (!Number.isInteger(seed.year) || seed.year < 1500 || seed.year > new Date().getFullYear() + 2)) throw new Error('论文年份无效。');
  if (seed.doi !== undefined && (typeof seed.doi !== 'string' || seed.doi.length > 500)) throw new Error('论文标识无效。');
  return { title: seed.title, authors: seed.authors, year: seed.year, venue: typeof seed.venue === 'string' ? seed.venue.slice(0, 1000) : undefined,
    url: seed.url, doi: seed.doi, ...(seed.linkOnly === true ? { linkOnly: true as const } : {}), ...(typeof seed.preprint === 'boolean' ? { preprint: seed.preprint } : {}) };
}
export function createRouter(deps: RouterDependencies) {
  let writing = Promise.resolve();
  let cacheEpoch = 0;
  // Every production configuration mutation and model snapshot goes through this
  // worker-local queue. Never pair an endpoint from one revision with another key.
  let configurationQueue = Promise.resolve();
  function withConfiguration<T>(action: () => Promise<T>): Promise<T> {
    const result = configurationQueue.then(action, action);
    configurationQueue = result.then(() => {}, () => {});
    return result;
  }
  const resolving = new Map<string, Promise<Resolution>>();
  const previewMemory = new Map<string, Resolution>();
  const generatedMemory = new Map<string, Generated>();
  const generating = new Map<string, Promise<Generated>>();
  async function updateSavedCopy(paper: Paper, generated: Generated): Promise<Generated> {
    try {
      return await withConfiguration(async () => {
        const currentFingerprint = await deps.fingerprint(paper, await deps.readSettings());
        if (generated.fingerprint === currentFingerprint) await deps.collection.updateGenerated(paper, generated);
        return generated;
      });
    }
    catch (error) {
      // A full collection must not turn a valid, already cached model response
      // into a generation failure or make every explicit retry fail again.
      return { ...generated, collectionWarning: error instanceof Error ? error.message.slice(0, 300) : '操作失败，请重试。' };
    }
  }
  async function entries(): Promise<Entry[]> {
    await writing;
    const stored = await deps.getSession('paperRegistry');
    return Array.isArray(stored) ? stored.filter((e: Entry) => e.at > Date.now() - 7 * 86400000) : [];
  }
  function save(entry: Entry, epoch = cacheEpoch) {
    const work = writing.then(async () => {
      if (epoch !== cacheEpoch) return;
      const stored = await deps.getSession('paperRegistry');
      const list: Entry[] = Array.isArray(stored) ? stored : [];
      const next = [...list.filter(e => e.key !== entry.key && e.at > Date.now() - 7 * 86400000), entry].slice(-200);
      while (next.length && new TextEncoder().encode(JSON.stringify(next)).byteLength > 4 * 1024 * 1024) next.shift();
      await deps.setSession('paperRegistry', next);
    });
    writing = work.catch(() => {});
    return work;
  }
  async function getPaper(tab: number, id: unknown) {
    if (typeof id !== 'string') throw new Error('论文标识无效。');
    const record = (await entries()).reverse().find(e => e.tab === tab && e.resolution.paper.id === id);
    if (!record) throw new Error('请先在当前标签页打开论文卡片并确认匹配。');
    return record.resolution.paper;
  }
  function modelContext() { return withConfiguration(async () => {
    const settings = await deps.readSettings();
    if (!settings.consent) throw new Error('请先在设置中同意发送论文文本。');
    if (!settings.baseUrl || !settings.model) throw new Error('请先配置模型服务。');
    const origin = new URL(settings.baseUrl).origin;
    if (!await deps.hasPermission(origin + '/*')) throw new Error('模型网站访问权限未授予，请在设置中重新保存。');
    const { apiKey } = await deps.readCredentials();
    if (!apiKey) throw new Error('请先填写模型 API Key；会话密钥在浏览器重启后需要重新填写。');
    return { settings, apiKey };
  }); }
  const registryKey = (tab: number, seed: PaperSeed) => `${tab}:${previewKey(seed)}`;
  async function archived(seed: PaperSeed) {
    try { return await deps.getPreview(seed) ?? previewMemory.get(previewKey(seed)); }
    catch (error) {
      const memory = previewMemory.get(previewKey(seed));
      if (memory) return memory;
      const saved = await findSaved(seed);
      if (saved && (saved.generated || saved.paper.source !== 'Google Scholar' || saved.candidates?.length)) return { paper: saved.paper, candidates: saved.candidates ?? [] };
      throw error;
    }
  }
  async function archive(seed: PaperSeed, resolution: Resolution, epoch = cacheEpoch) {
    if (epoch !== cacheEpoch) return;
    previewMemory.set(previewKey(seed), resolution);
    try { await deps.putPreview(seed, resolution); }
    catch { resolution.cacheWarning = '无法保存本地归档，请检查可用空间后重试；现有数据未删除。'; }
  }
  function needsSourceRefresh(seed: PaperSeed, resolution?: Resolution): boolean {
    return Boolean(resolution && resolution.lookupVersion !== 2 && !resolution.paper.abstract
      && resolution.paper.matchStatus !== 'confirmed' && !resolution.candidates.length && normalizeSourceUrl(seed.url));
  }
  async function assertPreviewStillEnabled(seed: PaperSeed, paper?: Paper) {
    if ((await deps.readSettings()).hoverEnabled !== false) return;
    // A Save action independently authorizes background completion, even when
    // its lookup/model promise was first created by an overlapping preview.
    const saved = await findSaved(seed, paper);
    if (saved?.completion && ['queued', 'resolving', 'generating'].includes(saved.completion.status)) return;
    throw new Error('悬停预览已关闭，请点击插件图标开启。');
  }
  async function resolve(seed: PaperSeed, retry = false, fromPreview = false): Promise<Resolution> {
    const key = previewKey(seed);
    let existing = await archived(seed);
    if (!existing) {
      const saved = await findSaved(seed);
      if (saved) existing = { paper: saved.paper, candidates: saved.candidates ?? [] };
    }
    // Preserve every loaded result, but an explicit retry can re-query failures.
    if (!retry && existing && !needsSourceRefresh(seed, existing) && (!existing.warning || existing.paper.matchStatus !== 'unresolved' || existing.candidates.length)) return existing;
    if (!resolving.has(key)) {
      const epoch = cacheEpoch;
      const operation = (async () => {
        const { openAlexKey } = await deps.readCredentials();
        if (fromPreview) await assertPreviewStillEnabled(seed);
        let resolution = await deps.resolvePaper(seed, openAlexKey);
        // Failed refreshes must not erase a usable source or a paid translation.
        if (existing?.paper.abstract && !resolution.paper.abstract
          || existing && existing.paper.matchStatus !== 'unresolved' && resolution.paper.matchStatus === 'unresolved') {
          resolution = { ...existing!, lookupVersion: resolution.lookupVersion, warning: resolution.warning, sourceAccess: resolution.sourceAccess };
        }
        await archive(seed, resolution, epoch);
        return resolution;
      })();
      resolving.set(key, operation);
      void operation.finally(() => resolving.delete(key)).catch(() => {});
    }
    return resolving.get(key)!;
  }
  async function cached(paper: Paper, settings?: Settings): Promise<Generated | undefined> {
    const fingerprint = await deps.fingerprint(paper, settings ?? await deps.readSettings());
    let stored: Generated | undefined;
    let readError: unknown;
    try { stored = await deps.getCached(fingerprint); } catch (error) { readError = error; }
    const result = stored ?? generatedMemory.get(fingerprint) ?? (await deps.collection.list()).items.find(item => item.paper.id === paper.id && item.generated?.fingerprint === fingerprint)?.generated;
    if (!result && readError) throw readError;
    return result;
  }
  async function generate(paper: Paper, fromPreview = false): Promise<Generated> {
    const initialSettings = await deps.readSettings();
    const initialFingerprint = await deps.fingerprint(paper, initialSettings);
    const existing = await cached(paper, initialSettings);
    if (existing) return updateSavedCopy(paper, existing);
    const { settings, apiKey } = await modelContext();
    const fingerprint = await deps.fingerprint(paper, settings);
    if (fingerprint !== initialFingerprint) {
      const latest = await cached(paper, settings);
      if (latest) return updateSavedCopy(paper, latest);
    }
    if (!generating.has(fingerprint)) {
      const epoch = cacheEpoch;
      const generation = (async () => {
        if (fromPreview) await assertPreviewStillEnabled(paper, paper);
        let result = await deps.generate(paper, settings, apiKey);
        if (epoch === cacheEpoch) {
          generatedMemory.set(fingerprint, result);
          try { await deps.putCached(result); }
          catch { result = { ...result, cacheWarning: '译文已生成，但本机存储失败；请立即复制或导出，避免关闭浏览器后丢失。' }; generatedMemory.set(fingerprint, result); }
        }
        return updateSavedCopy(paper, result);
      })();
      generating.set(fingerprint, generation);
      void generation.finally(() => generating.delete(fingerprint)).catch(() => {});
    }
    return generating.get(fingerprint)!;
  }
  async function finishSaved(item: SavedPaper, paper: Paper, generated: Generated) {
    await withConfiguration(async () => {
      const settings = await deps.readSettings();
      const current = (await deps.collection.list()).items.find(value => value.id === item.id && value.savedAt === item.savedAt);
      if (!current) return;
      const expected = await deps.fingerprint(paper, settings);
      if (await deps.fingerprint(current.paper, settings) !== expected) return;
      const output = generated.fingerprint === expected ? generated : await cached(paper, settings);
      await deps.collection.update(item.id, item.savedAt, output
        ? { generated: output, candidates: [], completion: { status: 'ready', updatedAt: Date.now() } }
        : { completion: { status: 'needs-configuration', updatedAt: Date.now(), error: '模型配置已更改，旧译文已保留；请按当前配置手动重试。' } }, paper);
    });
  }
  const jobs = createCompletionQueue({ collection: deps.collection, resolve, cached, generate, finish: finishSaved });
  async function findSaved(seed: PaperSeed, paper?: Paper) {
    const key = previewKey(seed);
    const { items } = await deps.collection.list();
    const destination = normalizeSourceUrl(seed.url);
    return items.find(item => item.sourceKey === key)
      ?? (destination ? items.find(item => (seed.linkOnly || item.seed?.linkOnly)
        && normalizeSourceUrl(item.seed?.url ?? item.paper.url) === destination) : undefined)
      ?? (paper ? items.find(item => item.paper.id === paper.id) : undefined);
  }
  async function queueSaved(item: SavedPaper) {
    const updated = await deps.collection.update(item.id, item.savedAt, { completion: { status: 'queued', updatedAt: Date.now(), refreshMetadata: true } });
    jobs.kick();
    return updated;
  }
  const route = async (input: unknown, sender: chrome.runtime.MessageSender): Promise<Response<unknown>> => {
    try {
      const msg = input as Record<string, unknown>;
      if (!msg || typeof msg.type !== 'string' || sender.id !== deps.extensionId) throw new Error('请求来源无效。');
      const url = new URL(sender.url ?? '');
      const trusted = url.href === `chrome-extension://${deps.extensionId}/options.html`;
      const collectionPage = url.href === `chrome-extension://${deps.extensionId}/collection.html`;
      const sourcePage = url.protocol === 'chrome-extension:' && url.host === deps.extensionId && url.pathname === '/source-access.html' && !url.search;
      const popup = url.href === `chrome-extension://${deps.extensionId}/popup.html`;
      const topFrame = sender.frameId === undefined || sender.frameId === 0;
      const scholar = url.origin === 'https://scholar.google.com' && url.pathname === '/scholar';
      const web = url.protocol === 'https:' && !url.username && !url.password && topFrame && Number.isInteger(sender.tab?.id)
        && (scholar || await deps.hasPermission(url.origin + '/*'));
      if (!trusted && !collectionPage && !web && !sourcePage && !popup) throw new Error('此页面不支持文献助手。');
      if (popup && !['GET_SETTINGS', 'GET_HOVER_STATE', 'SET_HOVER_ENABLED', 'OPEN_SETTINGS', 'OPEN_COLLECTION'].includes(msg.type)) throw new Error('请在扩展设置页执行此操作。');
      if (['GET_HOVER_STATE', 'SET_HOVER_ENABLED'].includes(msg.type) && !popup) throw new Error('请在插件菜单中切换悬停预览。');
      if (web && !['GET_SETTINGS', 'OPEN_SETTINGS', 'OPEN_COLLECTION'].includes(msg.type)
        && (await deps.readSettings()).hoverEnabled === false) throw new Error('悬停预览已关闭，请点击插件图标开启。');
      if (sourcePage && msg.type !== 'GET_SETTINGS') throw new Error('请在扩展设置页执行此操作。');
      const privileged = ['SAVE_SETTINGS', 'TEST_CONNECTION', 'CLEAR_CACHE', 'CLEAR_KEYS'];
      if (privileged.includes(msg.type) && !trusted) throw new Error('请在扩展设置页执行此操作。');
      const collectionOnly = ['GET_COLLECTION', 'REMOVE_SAVED', 'REORDER_SAVED', 'CLEAR_COLLECTION', 'EXPORT_COLLECTION', 'GET_EXPORT', 'RETRY_DOWNLOAD', 'RETRY_SAVED', 'CONFIRM_SAVED'];
      if (collectionOnly.includes(msg.type) && !collectionPage) throw new Error('请在缓存文章管理页执行此操作。');
      const tab = sender.tab?.id ?? -1;
      let data: unknown;
      switch (msg.type) {
        case 'GET_HOVER_STATE': {
          if (!deps.getHoverState) throw new Error('插件菜单不可用，请重新加载扩展。');
          data = await deps.getHoverState(); break;
        }
        case 'SET_HOVER_ENABLED': {
          if (!deps.setHoverEnabled || typeof msg.enabled !== 'boolean') throw new Error('开关状态无效。');
          data = await deps.setHoverEnabled(msg.enabled); break;
        }
        case 'GET_SETTINGS': data = await deps.readSettings(); break;
        case 'SAVE_SETTINGS': {
          const settings = msg.settings as Settings;
          if (!settings || typeof settings.baseUrl !== 'string') throw new Error('配置格式无效。');
          if (settings.baseUrl && !await deps.hasPermission(new URL(settings.baseUrl).origin + '/*')) throw new Error('请先授予模型域名访问权限。');
          for (const name of ['apiKey', 'openAlexKey']) if (msg[name] !== undefined && (typeof msg[name] !== 'string' || (msg[name] as string).length > 4096)) throw new Error('密钥格式无效。');
          data = await withConfiguration(() => deps.saveSettings(settings, { apiKey: msg.apiKey as string | undefined, openAlexKey: msg.openAlexKey as string | undefined }));
          break;
        }
        case 'CLEAR_KEYS': await withConfiguration(() => deps.clearKeys()); break;
        case 'CLEAR_CACHE': cacheEpoch++; previewMemory.clear(); generatedMemory.clear(); await deps.clearCache(); await writing; await deps.setSession('paperRegistry', []); break;
        case 'OPEN_SETTINGS': await deps.openSettings(); break;
        case 'OPEN_COLLECTION': await deps.openCollection(); break;
        case 'OPEN_SOURCE_ACCESS': {
          if (!web || !deps.openSourceAccess) throw new Error('请在网页中预览论文链接。');
          const seed = parseSeed(msg.seed);
          const record = (await entries()).find(entry => entry.key === registryKey(tab, seed));
          const access = record?.resolution.sourceAccess;
          if (!access || normalizeSourceUrl(access.url) !== access.url || new URL(access.url).origin !== access.origin) throw new Error('论文链接无效。');
          await deps.openSourceAccess(access.url);
          break;
        }
        case 'SAVE_PAPER': {
          if (!web) throw new Error('请在网页中预览论文链接。');
          data = await withConfiguration(async () => {
            const seed = msg.seed === undefined ? undefined : parseSeed(msg.seed);
            // New saves never wait for archive migration or an external request.
            // A displayed paper is already registered; otherwise save its visible seed.
            const registered = msg.paperId === undefined ? undefined : await getPaper(tab, msg.paperId);
            const resolution = seed ? previewMemory.get(previewKey(seed)) : undefined;
            const paper = registered ?? resolution?.paper ?? (seed ? unresolvedPaper(seed) : await getPaper(tab, msg.paperId));
            const source = seed ?? paper;
            const existing = await findSaved(source, paper);
            if (existing) return existing;
            const generated = seed ? undefined : await cached(paper, await deps.readSettings()).catch(() => undefined);
            return deps.collection.save(paper, generated, {
              seed: source, sourceKey: previewKey(source), candidates: resolution?.candidates ?? [],
              completion: { status: generated ? 'ready' : 'queued', updatedAt: Date.now() },
            });
          });
          // Acknowledgment depends only on local storage, never on metadata/model work.
          jobs.kick();
          break;
        }
        case 'RETRY_SAVED': {
          const item = (await deps.collection.list()).items.find(value => value.id === msg.id);
          if (!item) throw new Error('缓存文章不存在，请刷新后重试。');
          if (item.completion && ['queued', 'resolving', 'generating', 'needs-confirmation'].includes(item.completion.status)) { data = item; break; }
          data = await queueSaved(item);
          break;
        }
        case 'CONFIRM_SAVED': {
          const item = (await deps.collection.list()).items.find(value => value.id === msg.id);
          const candidate = item?.candidates?.find(value => value.id === msg.candidateId);
          if (!item || !candidate) throw new Error('候选已失效，请重新打开卡片。');
          const resolution: Resolution = { paper: { ...candidate, matchStatus: 'confirmed' }, candidates: [] };
          await archive(item.seed ?? item.paper, resolution);
          data = await deps.collection.update(item.id, item.savedAt, { paper: resolution.paper, candidates: [], completion: { status: 'queued', updatedAt: Date.now() } });
          jobs.kick();
          break;
        }
        case 'GET_COLLECTION': data = await deps.collection.list(); break;
        case 'REMOVE_SAVED': data = await deps.collection.remove(msg.id as string, msg.revision as number); break;
        case 'REORDER_SAVED': data = await deps.collection.reorder(msg.ids as string[], msg.revision as number); break;
        case 'CLEAR_COLLECTION': data = await deps.collection.clear(msg.revision as number); break;
        case 'EXPORT_COLLECTION': {
          const snapshot = await deps.collection.list();
          if (snapshot.revision !== msg.revision) throw new Error('缓存列表已更新，请刷新后重试。');
          data = await deps.exports.start(snapshot, (await deps.readSettings()).uiLanguage);
          break;
        }
        case 'GET_EXPORT': data = await deps.exports.get(); break;
        case 'RETRY_DOWNLOAD': {
          if (typeof msg.batchId !== 'string' || typeof msg.itemId !== 'string') throw new Error('下载任务已变化，请刷新后重试。');
          data = await deps.exports.retry(msg.batchId, msg.itemId); break;
        }
        case 'TEST_CONNECTION': { const ctx = await modelContext(); await deps.testConnection(ctx.settings, ctx.apiKey); break; }
        case 'GET_PREVIEW_STATES': {
          if (!web) throw new Error('请在网页中预览论文链接。');
          if (!Array.isArray(msg.seeds) || msg.seeds.length > 100) throw new Error('论文信息格式不正确，请刷新搜索结果。');
          const seeds = msg.seeds.map(parseSeed);
          const { items } = await deps.collection.list();
          data = await Promise.all(seeds.map(async seed => {
            const key = previewKey(seed);
            if (items.some(item => item.sourceKey === key)) return 'saved';
            try {
              const resolution = await archived(seed);
              if (resolution && items.some(item => item.paper.id === resolution.paper.id)) return 'saved';
              return resolution ? 'viewed' : 'unviewed';
            } catch { return 'unknown'; }
          }));
          break;
        }
        case 'GET_PREVIEW': {
          if (!web) throw new Error('请在网页中预览论文链接。');
          const seed = parseSeed(msg.seed);
          let resolution: Resolution | undefined;
          let archiveError: unknown;
          try { resolution = await archived(seed); } catch (error) { archiveError = error; }
          const saved = await findSaved(seed, resolution?.paper);
          if (archiveError && !saved) throw archiveError;
          // Explicitly saved papers survive clearing the separate preview archive.
          if (!resolution && saved) resolution = { paper: saved.paper, candidates: saved.candidates ?? [] };
          if (resolution) await save({ key: registryKey(tab, seed), tab, resolution, at: Date.now() });
          let generated = resolution ? await cached(resolution.paper) : undefined;
          if (!generated && saved?.generated && resolution && saved.generated.fingerprint === await deps.fingerprint(resolution.paper, await deps.readSettings())) generated = saved.generated;
          data = { resolution, generated, saved, needsRefresh: needsSourceRefresh(seed, resolution) && !generated?.abstractTranslated && !generated?.summary };
          break;
        }
        case 'RESOLVE': {
          if (!web) throw new Error('请在网页中预览论文链接。');
          const seed = parseSeed(msg.seed);
          const epoch = cacheEpoch;
          const resolution = await resolve(seed, msg.retry === true, true);
          await save({ key: registryKey(tab, seed), tab, resolution, at: Date.now() }, epoch);
          const saved = await findSaved(seed, resolution.paper);
          if (saved && !['queued', 'resolving', 'generating'].includes(saved.completion?.status ?? '') && resolution.paper.abstract && resolution.paper.matchStatus !== 'unresolved') {
            await deps.collection.update(saved.id, saved.savedAt, { paper: resolution.paper, candidates: [], completion: { status: 'queued', updatedAt: Date.now() } }, saved.paper);
            jobs.kick();
          }
          data = resolution;
          break;
        }
        case 'CONFIRM': {
          if (!web) throw new Error('请在网页中预览论文链接。');
          const seed = parseSeed(msg.seed);
          const key = registryKey(tab, seed);
          const record = (await entries()).find(e => e.key === key);
          const candidate = record?.resolution.candidates.find(p => p.id === msg.candidateId);
          if (!record || !candidate) throw new Error('候选已失效，请重新打开卡片。');
          const resolution: Resolution = { paper: { ...candidate, matchStatus: 'confirmed' }, candidates: [] };
          await save({ ...record, resolution, at: Date.now() });
          await archive(seed, resolution);
          const saved = await findSaved(seed, resolution.paper);
          if (saved) {
            await deps.collection.update(saved.id, saved.savedAt, { paper: resolution.paper, candidates: [], completion: { status: 'queued', updatedAt: Date.now() } });
            jobs.kick();
          }
          data = resolution;
          break;
        }
        case 'GET_CACHED': {
          const paper = await getPaper(tab, msg.paperId);
          data = await cached(paper);
          break;
        }
        case 'GENERATE': {
          const paper = await getPaper(tab, msg.paperId);
          data = await generate(paper, true);
          break;
        }
        default: throw new Error('不支持的扩展请求。');
      }
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : '操作失败，请重试。' };
    }
  };
  return Object.assign(route, { resume: jobs.resume, idle: jobs.idle });
}
