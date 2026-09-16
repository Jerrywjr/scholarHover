import type { Credentials, Generated, Paper, PaperSeed, Resolution, Response, Settings, SettingsView } from '../shared/types';
import type { createCollectionStore } from './collection';
import type { createExportManager } from './downloads';

export interface RouterDependencies {
  extensionId: string;
  getSession(key: string): Promise<unknown>;
  setSession(key: string, value: unknown): Promise<void>;
  readSettings(): Promise<SettingsView>;
  readCredentials(): Promise<Credentials>;
  saveSettings(settings: Settings, keys?: { apiKey?: string; openAlexKey?: string }): Promise<SettingsView>;
  clearKeys(): Promise<void>;
  clearCache(): Promise<void>;
  resolvePaper(seed: PaperSeed, openAlexKey?: string): Promise<Resolution>;
  fingerprint(paper: Paper, settings: Settings): Promise<string>;
  getCached(fingerprint: string): Promise<Generated | undefined>;
  putCached(value: Generated): Promise<void>;
  generate(paper: Paper, settings: Settings, apiKey: string): Promise<Generated>;
  testConnection(settings: Settings, apiKey: string): Promise<void>;
  hasPermission(origin: string): Promise<boolean>;
  openSettings(): Promise<void>;
  openCollection(): Promise<void>;
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
    url: seed.url, doi: seed.doi, ...(typeof seed.preprint === 'boolean' ? { preprint: seed.preprint } : {}) };
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
  return async (input: unknown, sender: chrome.runtime.MessageSender): Promise<Response<unknown>> => {
    try {
      const msg = input as Record<string, unknown>;
      if (!msg || typeof msg.type !== 'string' || sender.id !== deps.extensionId) throw new Error('请求来源无效。');
      const url = new URL(sender.url ?? '');
      const trusted = url.href === `chrome-extension://${deps.extensionId}/options.html`;
      const collectionPage = url.href === `chrome-extension://${deps.extensionId}/collection.html`;
      const scholar = url.origin === 'https://scholar.google.com' && url.pathname === '/scholar' && Number.isInteger(sender.tab?.id);
      if (!trusted && !collectionPage && !scholar) throw new Error('此页面不支持文献助手。');
      const privileged = ['SAVE_SETTINGS', 'TEST_CONNECTION', 'CLEAR_CACHE', 'CLEAR_KEYS'];
      if (privileged.includes(msg.type) && !trusted) throw new Error('请在扩展设置页执行此操作。');
      const collectionOnly = ['GET_COLLECTION', 'REMOVE_SAVED', 'REORDER_SAVED', 'CLEAR_COLLECTION', 'EXPORT_COLLECTION', 'GET_EXPORT', 'RETRY_DOWNLOAD'];
      if (collectionOnly.includes(msg.type) && !collectionPage) throw new Error('请在缓存文章管理页执行此操作。');
      const tab = sender.tab?.id ?? -1;
      let data: unknown;
      switch (msg.type) {
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
        case 'CLEAR_CACHE': cacheEpoch++; await deps.clearCache(); await writing; await deps.setSession('paperRegistry', []); break;
        case 'OPEN_SETTINGS': await deps.openSettings(); break;
        case 'OPEN_COLLECTION': await deps.openCollection(); break;
        case 'SAVE_PAPER': {
          if (!scholar) throw new Error('请在 Scholar 搜索结果页预览论文。');
          const paper = await getPaper(tab, msg.paperId);
          data = await withConfiguration(async () => {
            const generated = await deps.getCached(await deps.fingerprint(paper, await deps.readSettings()));
            return deps.collection.save(paper, generated);
          });
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
        case 'RESOLVE': {
          if (!scholar) throw new Error('请在 Scholar 搜索结果页预览论文。');
          const seed = parseSeed(msg.seed);
          const key = `${tab}:${JSON.stringify(seed)}`;
          const existing = (await entries()).find(e => e.key === key);
          // Failed provider responses remain retryable; successful metadata reuses session cache.
          if (existing && !existing.resolution.warning) { data = existing.resolution; break; }
          if (!resolving.has(key)) {
            const epoch = cacheEpoch;
            const operation = (async () => {
              const { openAlexKey } = await deps.readCredentials();
              const resolution = await deps.resolvePaper(seed, openAlexKey);
              await save({ key, tab, resolution, at: Date.now() }, epoch);
              return resolution;
            })();
            resolving.set(key, operation);
            void operation.finally(() => resolving.delete(key)).catch(() => {});
          }
          data = await resolving.get(key);
          break;
        }
        case 'CONFIRM': {
          const seed = parseSeed(msg.seed);
          const key = `${tab}:${JSON.stringify(seed)}`;
          const record = (await entries()).find(e => e.key === key);
          const candidate = record?.resolution.candidates.find(p => p.id === msg.candidateId);
          if (!record || !candidate) throw new Error('候选已失效，请重新打开卡片。');
          const resolution: Resolution = { paper: { ...candidate, matchStatus: 'confirmed' }, candidates: [] };
          await save({ ...record, resolution, at: Date.now() });
          data = resolution;
          break;
        }
        case 'GET_CACHED': {
          const paper = await getPaper(tab, msg.paperId);
          data = await deps.getCached(await deps.fingerprint(paper, await deps.readSettings()));
          break;
        }
        case 'GENERATE': {
          const paper = await getPaper(tab, msg.paperId);
          const { settings, apiKey } = await modelContext();
          const fingerprint = await deps.fingerprint(paper, settings);
          const cached = await deps.getCached(fingerprint);
          if (cached) { data = await updateSavedCopy(paper, cached); break; }
          if (!generating.has(fingerprint)) {
            const epoch = cacheEpoch;
            const generation = (async () => {
              const result = await deps.generate(paper, settings, apiKey);
              if (epoch === cacheEpoch) await deps.putCached(result);
              return updateSavedCopy(paper, result);
            })();
            generating.set(fingerprint, generation);
            void generation.finally(() => generating.delete(fingerprint)).catch(() => {});
          }
          data = await generating.get(fingerprint);
          break;
        }
        default: throw new Error('不支持的扩展请求。');
      }
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : '操作失败，请重试。' };
    }
  };
}
