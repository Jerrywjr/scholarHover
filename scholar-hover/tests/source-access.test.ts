import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSourceAccessPage } from '../src/source-access/index.ts';

const html = readFileSync('source-access.html', 'utf8');
const flush = async () => { for (let tick = 0; tick < 8; tick += 1) await Promise.resolve(); };
const grant = () => document.querySelector<HTMLButtonElement>('#grant-access')!;
beforeEach(() => {
  document.documentElement.innerHTML = html;
  window.location.hash = encodeURIComponent('https://journals.example.org/article/42?view=full');
});
afterEach(() => { document.body.replaceChildren(); window.location.hash = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('source website permission page', () => {
  it('requests only the displayed origin synchronously in the click gesture and makes no metadata or model calls', async () => {
    let finish!: (value: boolean) => void;
    const request = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true, data: { uiLanguage: 'en' } }));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('chrome', { permissions: { request }, runtime: { sendMessage } });
    startSourceAccessPage(); await flush();
    expect(document.querySelector('#source-origin')?.textContent).toBe('https://journals.example.org');
    expect(document.querySelector('#source-url')?.textContent).toBe('https://journals.example.org/article/42?view=full');
    expect(request).not.toHaveBeenCalled();
    grant().click();
    expect(request).toHaveBeenCalledExactlyOnceWith({ origins: ['https://journals.example.org/*'] });
    expect(grant().disabled).toBe(true);
    finish(true); await flush();
    expect(document.querySelector('#access-status')?.textContent).toContain('Return to the search results');
    expect(sendMessage.mock.calls).toEqual([[{ type: 'GET_SETTINGS' }]]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['zh-CN', '允许读取此网站', '请返回搜索结果'],
    ['en', 'Allow access to this website', 'Return to the search results'],
    ['fr', 'Autoriser l’accès à ce site', 'Revenez aux résultats'],
    ['de', 'Zugriff auf diese Website erlauben', 'Kehren Sie zur Suche zurück'],
  ])('renders permission and return instructions in %s', async (uiLanguage, button, returnText) => {
    vi.stubGlobal('chrome', { permissions: { request: vi.fn().mockResolvedValue(true) }, runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { uiLanguage } }) } });
    startSourceAccessPage(); await flush();
    expect(document.documentElement.lang).toBe(uiLanguage);
    expect(grant().textContent).toBe(button); grant().click(); await flush();
    expect(document.querySelector('#access-status')?.textContent).toContain(returnText);
  });

  it.each(['https://127.0.0.1/paper', 'http://journals.example.org/paper', 'https://u:p@journals.example.org/paper', 'javascript:alert(1)', 'https://localhost/paper', '%bad-encoding'])('does not request access for unsafe or malformed input %s', async value => {
    window.location.hash = value === '%bad-encoding' ? value : encodeURIComponent(value);
    const request = vi.fn();
    vi.stubGlobal('chrome', { permissions: { request }, runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { uiLanguage: 'en' } }) } });
    startSourceAccessPage(); await flush();
    expect(grant().disabled).toBe(true); grant().click();
    expect(request).not.toHaveBeenCalled();
    expect(document.querySelector('#access-status')?.textContent).toContain('valid public HTTPS');
  });

  it('keeps a denied permission visible and allows a deliberate retry', async () => {
    const request = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.stubGlobal('chrome', { permissions: { request }, runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { uiLanguage: 'en' } }) } });
    startSourceAccessPage(); await flush(); grant().click(); await flush();
    expect(document.querySelector('#access-status')?.textContent).toContain('Access was not granted');
    expect(grant().disabled).toBe(false); expect(request).toHaveBeenCalledTimes(1);
    grant().click(); await flush(); expect(request).toHaveBeenCalledTimes(2);
    expect(document.querySelector('#access-status')?.textContent).toContain('Return to the search results');
  });
});
