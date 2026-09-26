import { afterEach, describe, expect, it, vi } from 'vitest';
import { startContentScript } from '../src/content/index.ts';
import type { Request } from '../src/shared/types.ts';

const settings = { uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', baseUrl: '', model: '', autoGenerate: false, consent: false, rememberKey: false, hasApiKey: false, hasOpenAlexKey: false, hoverEnabled: true };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function runtime(overrides: { enabled?: boolean; preview?: unknown; resolve?: (message: Request) => unknown } = {}) {
  let listener: ((message: unknown, sender: unknown) => void) | undefined;
  let enabled = overrides.enabled ?? true;
  const sendMessage = vi.fn((message: Request) => {
    if (message.type === 'RESOLVE' && overrides.resolve) return overrides.resolve(message);
    return Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, hoverEnabled: enabled }
      : message.type === 'GET_PREVIEW' ? overrides.preview ?? {} : message.type === 'RESOLVE' ? { paper: { id: 'link-1', ...message.seed, source: 'Link', sourceUrl: message.seed.url, matchStatus: 'unresolved' }, candidates: [] } : undefined });
  });
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage, onMessage: { addListener: (next: typeof listener) => { listener = next; }, removeListener: vi.fn() } } });
  return { sendMessage, toggle: (next: boolean, id = 'extension-id') => { if (id === 'extension-id') enabled = next; listener?.({ type: 'HOVER_STATE_CHANGED', enabled: next }, { id }); } };
}
function link(href = 'https://www.nature.com/articles/s41586-024-00000-0', label = 'A linked article') {
  document.body.innerHTML = `<a href="${href}"><span>${label}</span></a>`;
  return document.querySelector('a')!;
}
const root = () => document.getElementById('scholar-hover-card')?.shadowRoot;

describe('universal link hover', () => {
  it('only loads the hovered public link and offers immediate saving with a title-only source', async () => {
    vi.useFakeTimers(); const anchor = link(); const stub = runtime(); stops.push(startContentScript()); await flush();
    expect(stub.sendMessage.mock.calls.map(([m]) => m.type)).toEqual(['GET_SETTINGS']);
    anchor.firstElementChild!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(499);
    expect(root()?.querySelector('h2')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(root()?.querySelector('h2')?.textContent).toBe('A linked article');
    expect(root()?.querySelector<HTMLButtonElement>('[data-action="save"]')?.disabled).toBe(false);
    expect(root()?.textContent).toContain('暂无摘要');
    expect(root()?.textContent).not.toContain('Google Scholar');
    expect(stub.sendMessage.mock.calls.find(([m]) => m.type === 'RESOLVE')?.[0]).toEqual({ type: 'RESOLVE', seed: { title: 'A linked article', authors: [], url: anchor.href, linkOnly: true } });
    expect(stub.sendMessage.mock.calls.some(([m]) => m.type === 'GET_PREVIEW_STATES')).toBe(false);
  });
  it('opens keyboard-focused arXiv PDF links using their canonical article URL', async () => {
    vi.useFakeTimers(); const anchor = link('https://arxiv.org/pdf/2401.12345.pdf', 'PDF'); const stub = runtime(); stops.push(startContentScript());
    anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(root()?.querySelector('h2')?.textContent).toBe('PDF');
    const preview = stub.sendMessage.mock.calls.find(([m]) => m.type === 'GET_PREVIEW')?.[0];
    expect(preview && 'seed' in preview ? preview.seed?.url : undefined).toBe('https://arxiv.org/abs/2401.12345');
  });
  it.each(['#section', 'mailto:a@example.org', 'javascript:alert(1)', 'http://publisher.example/article', 'https://localhost/article', 'https://publisher.example/login'])('ignores unsupported or sensitive href %s', async href => {
    vi.useFakeTimers(); const anchor = link(href); const stub = runtime(); stops.push(startContentScript());
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(root()?.querySelector('h2') ?? null).toBeNull(); expect(stub.sendMessage.mock.calls.some(([m]) => m.type === 'RESOLVE')).toBe(false);
  });
  it('ignores download and editable links', async () => {
    vi.useFakeTimers(); const anchor = link(); anchor.download = 'paper.pdf'; const stub = runtime(); stops.push(startContentScript());
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); anchor.removeAttribute('download'); anchor.setAttribute('contenteditable', 'true');
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(stub.sendMessage.mock.calls.some(([m]) => m.type === 'GET_PREVIEW')).toBe(false);
  });
  it('loads a complete existing preview without another metadata or model call', async () => {
    vi.useFakeTimers(); const anchor = link(); const stub = runtime({ preview: { resolution: { paper: { id: 'cached', title: 'Verified cached paper', authors: [], url: anchor.href, abstract: 'Verified abstract', source: 'Original page', sourceUrl: anchor.href, matchStatus: 'matched' }, candidates: [] }, generated: { language: 'zh-CN', titleTranslated: '缓存译文', model: 'm' } } }); stops.push(startContentScript());
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(root()?.textContent).toContain('缓存译文'); expect(root()?.textContent).toContain('Verified abstract');
    expect(stub.sendMessage.mock.calls.some(([m]) => ['RESOLVE', 'GENERATE'].includes(m.type))).toBe(false);
  });
});

describe('live hover activation', () => {
  it('ignores hover while disabled and accepts only extension state updates', async () => {
    vi.useFakeTimers(); const anchor = link(); const stub = runtime({ enabled: false }); stops.push(startContentScript()); await flush();
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); expect(document.getElementById('scholar-hover-card')).toBeNull();
    stub.toggle(true, 'other-extension'); anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); expect(document.getElementById('scholar-hover-card')).toBeNull();
    stub.toggle(true); anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); expect(root()?.querySelector('h2')?.textContent).toBe('A linked article');
  });
  it('reloads model preferences when enable arrives before the initial settings response', async () => {
    vi.useFakeTimers(); const anchor = link();
    let listener!: (message: unknown, sender: unknown) => void;
    let finishInitial!: (value: unknown) => void;
    let settingsReads = 0;
    const configured = { ...settings, baseUrl: 'https://llm.example/v1', model: 'm', hasApiKey: true, consent: true, autoGenerate: true };
    const resolved = { paper: { id: 'verified', title: 'Verified article', authors: [], url: anchor.href, abstract: 'Verified abstract', source: 'Original page', sourceUrl: anchor.href, matchStatus: 'matched' }, candidates: [] };
    const sendMessage = vi.fn((message: Request) => {
      if (message.type === 'GET_SETTINGS' && ++settingsReads === 1) return new Promise(resolve => { finishInitial = resolve; });
      return Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? configured : message.type === 'GET_PREVIEW' ? { resolution: resolved }
        : message.type === 'GENERATE' ? { language: 'zh-CN', titleTranslated: '首次开启的译文', abstractTranslated: '译文摘要', summary: '要点', model: 'm' } : undefined });
    });
    vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage, onMessage: { addListener: (next: typeof listener) => { listener = next; }, removeListener: vi.fn() } } });
    stops.push(startContentScript());
    listener({ type: 'HOVER_STATE_CHANGED', enabled: true }, { id: 'extension-id' });
    finishInitial({ ok: true, data: { ...settings, hoverEnabled: false } }); await flush();
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(root()?.querySelector('h2')?.textContent).toBe('Verified article');
    expect(root()?.textContent).toContain('首次开启的译文');
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_SETTINGS')).toHaveLength(2);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GENERATE')).toHaveLength(1);
  });

  it('keeps off when refreshed enable preferences arrive after a subsequent disable', async () => {
    vi.useFakeTimers(); const anchor = link();
    let listener!: (message: unknown, sender: unknown) => void;
    let finishRefresh!: (value: unknown) => void;
    let reads = 0;
    const sendMessage = vi.fn((message: Request) => message.type === 'GET_SETTINGS' && ++reads === 2
      ? new Promise(resolve => { finishRefresh = resolve; }) : Promise.resolve({ ok: true, data: settings }));
    vi.stubGlobal('chrome', { runtime: { id: 'extension-id', sendMessage, onMessage: { addListener: (next: typeof listener) => { listener = next; }, removeListener: vi.fn() } } });
    stops.push(startContentScript()); await flush();
    listener({ type: 'HOVER_STATE_CHANGED', enabled: true }, { id: 'extension-id' }); await flush();
    expect(finishRefresh).toBeTypeOf('function');
    listener({ type: 'HOVER_STATE_CHANGED', enabled: false }, { id: 'extension-id' });
    finishRefresh({ ok: true, data: { ...settings, hoverEnabled: true } }); await flush();
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(document.getElementById('scholar-hover-card')).toBeNull();
    expect(sendMessage.mock.calls.some(([message]) => ['GET_PREVIEW', 'RESOLVE', 'GENERATE'].includes(message.type))).toBe(false);
  });

  it('cancels delayed opening on disable', async () => {
    vi.useFakeTimers(); const anchor = link(); const stub = runtime(); stops.push(startContentScript()); await flush();
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(100); stub.toggle(false); await vi.advanceTimersByTimeAsync(1000);
    expect(document.getElementById('scholar-hover-card')).toBeNull(); expect(stub.sendMessage.mock.calls.some(([m]) => m.type === 'RESOLVE')).toBe(false);
  });
  it('does not revive the card or start a model request after a pending resolution completes while off', async () => {
    vi.useFakeTimers(); const anchor = link(); let finish!: (value: unknown) => void; const stub = runtime({ resolve: () => new Promise(resolve => { finish = resolve; }) }); stops.push(startContentScript());
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500); stub.toggle(false);
    finish({ ok: true, data: { paper: { id: 'late', title: 'Late title', authors: [], url: anchor.href, source: 'Original page', sourceUrl: anchor.href, matchStatus: 'matched' }, candidates: [] } }); await flush();
    expect(document.getElementById('scholar-hover-card')).toBeNull(); expect(stub.sendMessage.mock.calls.some(([m]) => ['GENERATE', 'GET_CACHED'].includes(m.type))).toBe(false);
  });
  it('does not install duplicate listeners or remove the active host on reinjection', async () => {
    vi.useFakeTimers(); const anchor = link(); const stub = runtime(); stops.push(startContentScript()); const firstHost = document.getElementById('scholar-hover-card'); stops.push(startContentScript());
    expect(document.getElementById('scholar-hover-card')).toBe(firstHost); anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await vi.advanceTimersByTimeAsync(500);
    expect(stub.sendMessage.mock.calls.filter(([m]) => m.type === 'RESOLVE')).toHaveLength(1);
  });
});
