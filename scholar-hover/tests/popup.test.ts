import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { startPopup } from '../src/popup/index.ts';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const settings = { uiLanguage: 'en', outputLanguage: 'en', baseUrl: '', model: '', autoGenerate: false, consent: false, rememberKey: false, hasApiKey: false, hasOpenAlexKey: false };
function setup(state = { enabled: false, hasAccess: false }, language = 'en') {
  document.documentElement.innerHTML = new DOMParser().parseFromString(readFileSync('popup.html', 'utf8'), 'text/html').documentElement.innerHTML;
  const sendMessage = vi.fn(async (message: { type: string; enabled?: boolean }) => ({ ok: true, data: message.type === 'GET_SETTINGS' ? { ...settings, uiLanguage: language } : message.type === 'SET_HOVER_ENABLED' ? { enabled: message.enabled, hasAccess: true } : state }));
  const request = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request } });
  return { sendMessage, request };
}
const toggle = () => document.getElementById('hover-toggle') as HTMLButtonElement;
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('toolbar popup', () => {
  it('requests permission within the click before waiting, keeps OFF on denial and blocks repeat clicks', async () => {
    const { sendMessage, request } = setup();
    let finish!: (value: boolean) => void;
    request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    startPopup(); await flush();
    toggle().click();
    expect(request).toHaveBeenCalledWith({ origins: ['https://*/*'] });
    expect(toggle().disabled).toBe(true);
    toggle().dispatchEvent(new Event('click')); expect(request).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls.some(([m]) => m.type === 'SET_HOVER_ENABLED')).toBe(false);
    finish(false); await flush();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById('status')?.textContent).toContain('denied');
    expect(sendMessage.mock.calls.some(([m]) => m.type === 'SET_HOVER_ENABLED')).toBe(false);
  });
  it('enables with granted access and disables without requesting access', async () => {
    const { sendMessage, request } = setup({ enabled: false, hasAccess: true });
    startPopup(); await flush(); toggle().click(); await flush();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    toggle().click(); await flush();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(request).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SET_HOVER_ENABLED', enabled: false });
  });
  it('treats revoked access as OFF even if enabled was persisted', async () => {
    setup({ enabled: true, hasAccess: false }); startPopup(); await flush();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });
  it('does not claim OFF when saving OFF fails', async () => {
    const { sendMessage } = setup({ enabled: true, hasAccess: true });
    sendMessage.mockImplementation(async m => m.type === 'SET_HOVER_ENABLED' ? { ok: false, error: 'private provider error' } as never : { ok: true, data: m.type === 'GET_SETTINGS' ? settings : { enabled: true, hasAccess: true } });
    startPopup(); await flush(); toggle().click(); await flush();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('status')?.dataset.state).toBe('error');
    expect(document.getElementById('status')?.textContent).not.toContain('private provider');
  });
  it('reads the persisted state when a change partly succeeds before returning an error', async () => {
    const { sendMessage } = setup({ enabled: true, hasAccess: true });
    let persisted = true;
    sendMessage.mockImplementation(async m => {
      if (m.type === 'SET_HOVER_ENABLED') { persisted = false; throw new Error('unregister failed'); }
      return { ok: true, data: m.type === 'GET_SETTINGS' ? settings : { enabled: persisted, hasAccess: true } };
    });
    startPopup(); await flush(); toggle().click(); await flush();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById('status')?.dataset.state).toBe('error');
  });
  it('shows an unknown unavailable switch when failed changes cannot be read back', async () => {
    const { sendMessage } = setup({ enabled: true, hasAccess: true });
    let changed = false;
    sendMessage.mockImplementation(async m => {
      if (m.type === 'SET_HOVER_ENABLED') { changed = true; throw new Error('worker failed'); }
      if (m.type === 'GET_HOVER_STATE' && changed) throw new Error('worker unavailable');
      return { ok: true, data: m.type === 'GET_SETTINGS' ? settings : { enabled: true, hasAccess: true } };
    });
    startPopup(); await flush(); toggle().click(); await flush();
    expect(toggle().disabled).toBe(true);
    expect(toggle().textContent).toContain('Reading');
    expect((document.getElementById('retry') as HTMLButtonElement).hidden).toBe(false);
  });
  it('keeps the switch unavailable if state cannot be read and offers retry', async () => {
    const { sendMessage } = setup();
    sendMessage.mockImplementation(async m => { if (m.type === 'GET_HOVER_STATE') throw new Error('worker unavailable'); return { ok: true, data: settings }; });
    startPopup(); await flush();
    expect(toggle().disabled).toBe(true);
    expect(document.getElementById('status')?.dataset.state).toBe('error');
    expect((document.getElementById('retry') as HTMLButtonElement).hidden).toBe(false);
    sendMessage.mockImplementation(async m => ({ ok: true, data: m.type === 'GET_SETTINGS' ? settings : { enabled: false, hasAccess: true } }));
    (document.getElementById('retry') as HTMLButtonElement).click(); await flush(); expect(toggle().disabled).toBe(false);
  });
  it('opens settings and collection through background routes', async () => {
    const { sendMessage } = setup(); startPopup(); await flush();
    (document.getElementById('open-settings') as HTMLButtonElement).click(); await flush();
    (document.getElementById('open-collection') as HTMLButtonElement).click(); await flush();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'OPEN_SETTINGS' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'OPEN_COLLECTION' });
  });
  it.each([['zh-CN', '悬停'], ['en', 'Hover'], ['fr', 'survol'], ['de', 'Hover']])('uses saved UI language %s for the actual popup', async (language, heading) => {
    setup(undefined, language); startPopup(); await flush();
    expect(document.documentElement.lang).toBe(language);
    expect(document.getElementById('switch-heading')?.textContent).toContain(heading);
    expect(toggle().textContent).toContain('OFF');
    if (language !== 'zh-CN') expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/);
  });
});
