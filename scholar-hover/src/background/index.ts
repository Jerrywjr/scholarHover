import { createRouter } from './router';
import { initializeStorage, readSettings, readCredentials, saveSettings, clearKeys } from './settings';
import { getCached, putCached, clearCache } from './cache';
import { generatePaper, makeFingerprint, testConnection } from './model';
import { resolvePaper } from './metadata';

const ready = initializeStorage();
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
  getSession: async key => (await chrome.storage.session.get(key))[key],
  setSession: async (key, value) => { await chrome.storage.session.set({ [key]: value }); },
  readSettings, readCredentials, saveSettings, clearKeys, getCached, putCached, clearCache,
  resolvePaper, fingerprint: makeFingerprint,
  generate: (paper, settings, apiKey) => timeModel(() => generatePaper(paper, settings, apiKey)),
  testConnection: (settings, apiKey) => timeModel(() => testConnection(settings, apiKey)),
  hasPermission: async origin => chrome.permissions.contains({ origins: [origin] }),
  openSettings: async () => { await chrome.runtime.openOptionsPage(); },
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void ready.then(() => route(message, sender)).then(sendResponse).catch(() => sendResponse({ ok: false, error: '扩展存储初始化失败，请重新加载扩展。' }));
  return true;
});
chrome.action.onClicked.addListener(() => { void chrome.runtime.openOptionsPage(); });
