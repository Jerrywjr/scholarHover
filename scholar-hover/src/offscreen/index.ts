import { isBackgroundSender, type ModelCommand } from '../background/long-model';
import type { Generated } from '../shared/types';
import type { ParseSourceCommand } from '../background/source';
import { extractSourcePaper } from '../shared/source-page';

interface ModelWorkerReply {
  requestId: string;
  ok: boolean;
  data?: Generated;
  error?: string;
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const command = message as ModelCommand | ParseSourceCommand | null;
  if (command?.target !== 'scholar-hover-offscreen' || !['GENERATE_MODEL', 'PARSE_SOURCE'].includes(command.type)) return false;
  if (!isBackgroundSender(sender, chrome.runtime.id, chrome.runtime.getURL('background.js')) || typeof command.requestId !== 'string' || !command.requestId) return false;
  if (command.type === 'PARSE_SOURCE') {
    try {
      if (typeof command.html !== 'string' || command.html.length > 2 * 1024 * 1024) throw new Error('Invalid HTML');
      const data = extractSourcePaper(command.html, command.url, command.seed);
      sendResponse({ target: 'scholar-hover-background', requestId: command.requestId, ok: true, data });
    } catch { sendResponse({ target: 'scholar-hover-background', requestId: command.requestId, ok: false }); }
    return false;
  }

  const worker = new Worker(new URL('./model-worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  const finish = (reply: ModelWorkerReply) => {
    if (settled) return;
    settled = true;
    clearInterval(heartbeat);
    clearTimeout(watchdog);
    worker.terminate();
    sendResponse({ target: 'scholar-hover-background', ...reply });
  };
  // Chrome may suspend a service worker without extension events for 30 s.
  // These non-sensitive progress events keep the pending reply channel alive.
  const heartbeat = setInterval(() => {
    void chrome.runtime.sendMessage({ target: 'scholar-hover-background', type: 'MODEL_HEARTBEAT', requestId: command.requestId }).catch(() => {});
  }, 15_000);
  const watchdog = setTimeout(() => finish({ requestId: command.requestId, ok: false, error: '模型请求超时，请手动重试。' }), 195_000);
  worker.onmessage = (event: MessageEvent<ModelWorkerReply>) => {
    const reply = event.data;
    if (!reply || reply.requestId !== command.requestId || typeof reply.ok !== 'boolean') {
      finish({ requestId: command.requestId, ok: false, error: '模型后台返回无效，请重试。' });
      return;
    }
    finish(reply);
  };
  worker.onerror = () => finish({ requestId: command.requestId, ok: false, error: '模型后台运行失败，请重试。' });
  worker.postMessage(command);
  return true;
});
