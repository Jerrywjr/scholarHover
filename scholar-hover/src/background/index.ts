import { createRouter } from './router';
import { initializeStorage, readSettings, readCredentials, saveSettings, clearKeys } from './settings';
import { getCached, putCached, clearCache, getPreview, putPreview } from './cache';
import { makeFingerprint, testConnection } from './model';
import { generatePaperOffscreen } from './long-model';
import { resolvePaper } from './metadata';
import { createCollectionStore } from './collection';
import { createExportManager } from './downloads';
import type { ExportBatch } from '../shared/types';
import { createHoverControl } from './hover-control';

const HOVER_SCRIPT = 'paper-link-hover';
const hover = createHoverControl({
  read: async () => (await chrome.storage.local.get('hoverEnabled')).hoverEnabled === true,
  write: async enabled => { await chrome.storage.local.set({ hoverEnabled: enabled }); },
  hasAccess: () => chrome.permissions.contains({ origins: ['https://*/*'] }),
  isRegistered: async () => (await chrome.scripting.getRegisteredContentScripts({ ids: [HOVER_SCRIPT] })).length > 0,
  register: () => chrome.scripting.registerContentScripts([{ id: HOVER_SCRIPT, matches: ['https://*/*'],
    js: ['content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }]),
  unregister: () => chrome.scripting.unregisterContentScripts({ ids: [HOVER_SCRIPT] }),
  inject: async () => {
    const tabs = await chrome.tabs.query({ url: ['https://*/*'] });
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab =>
      chrome.scripting.executeScript({ target: { tabId: tab.id!, frameIds: [0] }, files: ['content.js'] })));
    // Chrome prevents injection into its own pages and its extension store.
  },
  notify: async enabled => {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab =>
      chrome.tabs.sendMessage(tab.id!, { type: 'HOVER_STATE_CHANGED', enabled }, { frameId: 0 })));
  },
  badge: async enabled => {
    await chrome.action.setBadgeText({ text: enabled ? 'ON' : 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ color: enabled ? '#087f8c' : '#697780' });
  },
});

const ready = initializeStorage();
const collection = createCollectionStore({
  read: async () => (await chrome.storage.local.get('savedCollection')).savedCollection,
  write: async value => { await chrome.storage.local.set({ savedCollection: value }); },
});
const exports = createExportManager({
  read: async () => (await chrome.storage.local.get('latestExport')).latestExport as ExportBatch | undefined,
  write: async value => { await chrome.storage.local.set({ latestExport: value }); },
  download: options => chrome.downloads.download(options),
  search: id => chrome.downloads.search({ id }),
  removeFile: id => chrome.downloads.removeFile(id),
  openPage: async url => { await chrome.tabs.create({ url, active: true }); },
});
async function timeModel<T>(operation: () => Promise<T>): Promise<T> {
  const start = performance.now();
  let ok = false;
  try { const value = await operation(); ok = true; return value; }
  finally {
    // Local diagnostics contain timing/status only: never inputs, endpoint URLs or keys.
    await chrome.storage.session.set({ lastModelTiming: { durationMs: Math.round(performance.now() - start), ok, at: Date.now() } }).catch(() => {});
  }
}
const route = createRouter({
  extensionId: chrome.runtime.id,
  getHoverState: hover.get, setHoverEnabled: hover.set,
  getSession: async key => (await chrome.storage.session.get(key))[key],
  setSession: async (key, value) => { await chrome.storage.session.set({ [key]: value }); },
  readSettings: async () => ({ ...await readSettings(), hoverEnabled: (await hover.get()).enabled }),
  readCredentials, saveSettings, clearKeys, getCached, putCached, clearCache, getPreview, putPreview,
  resolvePaper, fingerprint: makeFingerprint,
  generate: (paper, settings, apiKey) => timeModel(() => generatePaperOffscreen(paper, settings, apiKey)),
  testConnection: (settings, apiKey) => timeModel(() => testConnection(settings, apiKey)),
  hasPermission: async origin => chrome.permissions.contains({ origins: [origin] }),
  openSettings: async () => { await chrome.runtime.openOptionsPage(); },
  openCollection: async () => { await chrome.tabs.create({ url: chrome.runtime.getURL('collection.html') }); },
  openSourceAccess: async url => { await chrome.tabs.create({ url: chrome.runtime.getURL('source-access.html') + '#' + encodeURIComponent(url) }); },
  collection, exports,
});
// A collection recovery error must not prevent Settings or deletion controls
// from opening; storage initialization itself remains a required boundary.
const resumed = ready.then(() => route.resume().catch(() => {}));
void resumed.catch(() => {});
void ready.then(() => hover.sync()).catch(() => {});
chrome.permissions.onRemoved.addListener(() => { void ready.then(() => hover.sync()).catch(() => {}); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'scholar-hover-offscreen') return false;
  if (message?.target === 'scholar-hover-background' && message?.type === 'MODEL_HEARTBEAT') {
    if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('offscreen.html') && !sender.tab) sendResponse({ ok: true });
    return false;
  }
  void resumed.then(() => route(message, sender)).then(sendResponse).catch(() => sendResponse({ ok: false, error: '扩展存储初始化失败，请重新加载扩展。' }));
  return true;
});
chrome.downloads.onChanged.addListener(() => { void ready.then(() => exports.get()).catch(() => {}); });
