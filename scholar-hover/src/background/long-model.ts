import type { Generated, Paper, Settings } from '../shared/types';

export interface ModelCommand {
  target: 'scholar-hover-offscreen';
  type: 'GENERATE_MODEL';
  requestId: string;
  paper: Paper;
  settings: Settings;
  apiKey: string;
}

interface ModelReply {
  target: 'scholar-hover-background';
  requestId: string;
  ok: boolean;
  data?: Generated;
  error?: string;
}

export function isBackgroundSender(sender: Pick<chrome.runtime.MessageSender, 'id' | 'url' | 'tab'>, extensionId: string, backgroundUrl: string): boolean {
  return sender.id === extensionId && sender.url === backgroundUrl && !sender.tab;
}

interface OffscreenBridge {
  hasDocument(): Promise<boolean>;
  createDocument(): Promise<void>;
  sendMessage(message: ModelCommand): Promise<unknown>;
  randomId(): string;
}

export function createLongModelGenerator(bridge: OffscreenBridge) {
  let creating: Promise<void> | undefined;
  function ensureDocument(): Promise<void> {
    if (!creating) {
      creating = (async () => {
        if (await bridge.hasDocument()) return;
        try { await bridge.createDocument(); }
        catch (error) {
          // A previous service worker can race us during replacement.
          if (!await bridge.hasDocument()) throw error;
        }
      })().finally(() => { creating = undefined; });
    }
    return creating;
  }

  return async (paper: Paper, settings: Settings, apiKey: string): Promise<Generated> => {
    await ensureDocument();
    const requestId = bridge.randomId();
    const message: ModelCommand = { target: 'scholar-hover-offscreen', type: 'GENERATE_MODEL', requestId, paper, settings, apiKey };
    const reply = await bridge.sendMessage(message) as ModelReply | null;
    if (!reply || reply.target !== 'scholar-hover-background' || reply.requestId !== requestId || typeof reply.ok !== 'boolean') {
      throw new Error('模型后台返回无效，请重试。');
    }
    if (!reply.ok) throw new Error(typeof reply.error === 'string' && reply.error ? reply.error.slice(0, 300) : '模型请求失败，请重试。');
    if (!reply.data || typeof reply.data.titleTranslated !== 'string' || typeof reply.data.fingerprint !== 'string') {
      throw new Error('模型后台返回无效，请重试。');
    }
    return reply.data;
  };
}

export const generatePaperOffscreen = createLongModelGenerator({
  hasDocument: async () => (await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL('offscreen.html')],
  })).length > 0,
  createDocument: () => chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Run a long model request in a dedicated worker while Chrome suspends the extension service worker.',
  }),
  sendMessage: message => chrome.runtime.sendMessage(message),
  randomId: () => crypto.randomUUID(),
});
