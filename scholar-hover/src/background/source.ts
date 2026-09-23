import type { Paper, PaperSeed, Resolution } from '../shared/types';
import { normalizeSourceUrl } from '../shared/source-page';
import { ensureOffscreenDocument } from './offscreen-document';

export interface SourceReader {
  hasPermission(origin: string): Promise<boolean>;
  parseHtml(html: string, url: string, seed: PaperSeed): Promise<Paper | undefined>;
}
export interface ParseSourceCommand {
  target: 'scholar-hover-offscreen'; type: 'PARSE_SOURCE'; requestId: string;
  html: string; url: string; seed: PaperSeed;
}
const MAX_BYTES = 2 * 1024 * 1024;
const defaultReader: SourceReader = {
  hasPermission: origin => chrome.permissions.contains({ origins: [origin + '/*'] }),
  async parseHtml(html, url, seed) {
    await ensureOffscreenDocument();
    const requestId = crypto.randomUUID();
    const reply = await chrome.runtime.sendMessage({ target: 'scholar-hover-offscreen', type: 'PARSE_SOURCE', requestId, html, url, seed } satisfies ParseSourceCommand);
    if (reply?.target !== 'scholar-hover-background' || reply.requestId !== requestId || reply.ok !== true) throw new Error('原文解析失败，请重新读取摘要。');
    return reply.data as Paper | undefined;
  },
};

export async function readSourcePaper(seed: PaperSeed, timings: Record<string, number>, reader = defaultReader): Promise<Pick<Resolution, 'warning' | 'sourceAccess'> & { paper?: Paper }> {
  const url = normalizeSourceUrl(seed.url);
  if (!url) return {};
  const origin = new URL(url).origin;
  if (!await reader.hasPermission(origin)) return { sourceAccess: { url, origin }, warning: '原文网站访问权限未授予，请允许读取原文网站。' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const startedAt = Date.now();
  try {
    // Only a single user-visible paper URL is read. Do not follow redirects into
    // an unapproved host, send account cookies/keys, or execute the page's scripts.
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error', headers: { accept: 'text/html,application/xhtml+xml' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type)) throw new Error('原文链接未返回可读取的摘要网页。');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('响应内容过大');
    const stream = response.body?.getReader();
    if (!stream) throw new Error('响应正文不可读取');
    const decoder = new TextDecoder();
    let html = '', size = 0;
    try {
      while (true) {
        const chunk = await stream.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BYTES) { controller.abort(); throw new Error('响应内容过大'); }
        html += decoder.decode(chunk.value, { stream: true });
      }
      html += decoder.decode();
    } finally { stream.releaseLock(); }
    const finalUrl = response.url || url;
    if (normalizeSourceUrl(finalUrl) !== url) throw new Error('原文链接发生跳转，请打开原文页面查看。');
    const paper = await reader.parseHtml(html, finalUrl, seed);
    if (!paper) throw new Error('原文页面未提供可核验的论文信息，可能需要登录或验证。');
    return { paper, ...(!paper.abstract ? { warning: '原文页面未提供完整摘要。' } : {}) };
  } catch (error) {
    const detail = error instanceof DOMException && error.name === 'AbortError' ? '请求超时'
      : error instanceof TypeError ? '无法读取原文网页，请打开原文页面检查网络、跳转或访问限制。'
      : error instanceof Error ? error.message : '未知网络错误';
    return { warning: `原文读取失败：${detail}` };
  } finally { clearTimeout(timeout); timings.sourcePage = Date.now() - startedAt; }
}
