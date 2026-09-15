import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { startOptionsPage } from '../src/options/index.ts';

const view = { uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', baseUrl: 'https://api.example.com/v1', model: 'model-a', autoGenerate: true, consent: true, rememberKey: false, hasApiKey: true, hasOpenAlexKey: true };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
function input(id: string, value: string) {
  const field = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
  field.value = value;
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  return field;
}
function submit() {
  document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
}

function fixture() {
  const html = readFileSync('options.html', 'utf8');
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML;
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('options page', () => {
  it('preserves edits made while initial settings are loading and merges untouched fields', async () => {
    fixture();
    const loading = deferred<{ ok: true; data: typeof view }>();
    const sendMessage = vi.fn(() => loading.promise);
    const request = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request } });
    startOptionsPage();
    input('base-url', 'https://early.example.org/v1');
    input('model', 'early-model');
    input('api-key', 'early-key');
    input('openalex-key', 'early-openalex');
    input('ui-language', 'fr');
    input('output-language', 'en');
    const consent = document.querySelector('#consent') as HTMLInputElement;
    consent.checked = true; consent.dispatchEvent(new Event('change', { bubbles: true }));
    submit();
    expect(request).not.toHaveBeenCalled();
    loading.resolve({ ok: true, data: view }); await flush();
    expect((document.querySelector('#base-url') as HTMLInputElement).value).toBe('https://early.example.org/v1');
    expect((document.querySelector('#model') as HTMLInputElement).value).toBe('early-model');
    expect((document.querySelector('#api-key') as HTMLInputElement).value).toBe('early-key');
    expect((document.querySelector('#openalex-key') as HTMLInputElement).value).toBe('early-openalex');
    expect((document.querySelector('#output-language') as HTMLSelectElement).value).toBe('en');
    expect(document.documentElement.lang).toBe('fr');
    expect(consent.checked).toBe(true);
    expect((document.querySelector('#auto-generate') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('preserves later edits when a save finishes and serializes conflicting operations', async () => {
    fixture();
    const saving = deferred<{ ok: true; data: typeof view }>();
    const sendMessage = vi.fn((message: { type: string }) => message.type === 'SAVE_SETTINGS' ? saving.promise : Promise.resolve({ ok: true, data: view }));
    const request = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request } });
    startOptionsPage(); await flush();
    input('api-key', 'submitted-key'); input('openalex-key', 'submitted-openalex');
    submit(); await flush();
    input('ui-language', 'de'); input('output-language', 'fr');
    input('api-key', 'later-key'); input('openalex-key', 'later-openalex');
    submit();
    for (const id of ['clear-keys', 'clear-cache', 'test-connection']) document.getElementById(id)!.dispatchEvent(new Event('click'));
    await flush();
    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual(['GET_SETTINGS', 'SAVE_SETTINGS']);
    expect(request).toHaveBeenCalledTimes(1);
    saving.resolve({ ok: true, data: view }); await flush();
    expect((document.querySelector('#api-key') as HTMLInputElement).value).toBe('later-key');
    expect((document.querySelector('#openalex-key') as HTMLInputElement).value).toBe('later-openalex');
    expect((document.querySelector('#output-language') as HTMLSelectElement).value).toBe('fr');
    expect(document.documentElement.lang).toBe('de');
    (document.querySelector('#test-connection') as HTMLButtonElement).click(); await flush();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'TEST_CONNECTION')).toBe(false);
    expect(document.querySelector('#status')?.textContent).toContain('Speichern');
  });

  it('keeps endpoint, credentials and consent in one snapshot while permission is pending', async () => {
    fixture();
    const permission = deferred<boolean>();
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: view });
    const request = vi.fn(() => permission.promise);
    vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request } });
    startOptionsPage(); await flush();
    input('api-key', 'first-service-key'); input('openalex-key', 'first-openalex-key');
    submit();
    input('base-url', 'https://second.example.org/v1');
    input('api-key', 'second-service-key'); input('openalex-key', 'second-openalex-key');
    input('model', 'second-model'); input('ui-language', 'de'); input('output-language', 'fr');
    permission.resolve(true); await flush();
    expect(request).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_SETTINGS', settings: { uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', baseUrl: 'https://api.example.com/v1', model: 'model-a', autoGenerate: true, consent: true, rememberKey: false }, apiKey: 'first-service-key', openAlexKey: 'first-openalex-key' });
    expect((document.querySelector('#base-url') as HTMLInputElement).value).toBe('https://second.example.org/v1');
    expect((document.querySelector('#api-key') as HTMLInputElement).value).toBe('second-service-key');
    expect((document.querySelector('#consent') as HTMLInputElement).checked).toBe(false);
    (document.querySelector('#test-connection') as HTMLButtonElement).click(); await flush();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'TEST_CONNECTION')).toBe(false);
  });

  it('preserves keys typed after clearing stored keys has begun', async () => {
    fixture();
    const clearing = deferred<{ ok: true; data: undefined }>();
    const sendMessage = vi.fn((message: { type: string }) => message.type === 'CLEAR_KEYS' ? clearing.promise : Promise.resolve({ ok: true, data: view }));
    vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request: vi.fn() } });
    startOptionsPage(); await flush();
    input('api-key', 'old-input'); input('openalex-key', 'old-openalex');
    (document.querySelector('#clear-keys') as HTMLButtonElement).click();
    input('api-key', 'new-input'); input('openalex-key', 'new-openalex');
    clearing.resolve({ ok: true, data: undefined }); await flush();
    expect((document.querySelector('#api-key') as HTMLInputElement).value).toBe('new-input');
    expect((document.querySelector('#openalex-key') as HTMLInputElement).value).toBe('new-openalex');
    expect(document.querySelector('#key-state')?.textContent).toContain('未设置');
  });

  it.each([
    ['fr', 'Paramètres', 'Enregistrer', 'Par exemple : your-model'],
    ['de', 'Einstellungen', 'Speichern', 'Zum Beispiel: your-model'],
  ])('renders the actual options document in %s', async (language, title, save, placeholder) => {
    fixture();
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { ...view, uiLanguage: language } }) }, permissions: { request: vi.fn() } });
    startOptionsPage(); await flush();
    expect(document.documentElement.lang).toBe(language);
    expect(document.title).toContain(title);
    expect(document.querySelector('button[type="submit"]')?.textContent).toBe(save);
    expect((document.querySelector('#model') as HTMLInputElement).placeholder).toBe(placeholder);
    expect(document.querySelector('#privacy-heading')?.textContent).not.toContain('隐私');
    expect(document.querySelector('#key-state')?.textContent).not.toContain('已设置');
    expect(document.querySelector('[data-i18n="privacyPolicy"]')?.getAttribute('href')).toBe(`/PRIVACY.${language}.md`);
  });

  it('previews UI language without losing dirty fields or changing output language and consent', async () => {
    fixture();
    const sendMessage = vi.fn((message: { type: string; settings?: object }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? view : { ...view, ...message.settings } }));
    vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request: vi.fn().mockResolvedValue(true) } });
    startOptionsPage(); await flush();
    const base = document.querySelector('#base-url') as HTMLInputElement;
    base.value = 'https://new.example.org/v1'; base.dispatchEvent(new Event('input', { bubbles: true }));
    const apiKey = document.querySelector('#api-key') as HTMLInputElement;
    apiKey.value = 'unsaved-secret'; apiKey.dispatchEvent(new Event('input', { bubbles: true }));
    const openAlexKey = document.querySelector('#openalex-key') as HTMLInputElement;
    openAlexKey.value = 'unsaved-openalex';
    const consent = document.querySelector('#consent') as HTMLInputElement; consent.checked = true;
    const output = document.querySelector('#output-language') as HTMLSelectElement;
    expect(output).not.toBeNull(); output.value = 'en'; output.dispatchEvent(new Event('change', { bubbles: true }));
    const ui = document.querySelector('#ui-language') as HTMLSelectElement;
    expect(ui).not.toBeNull(); ui.value = 'fr'; ui.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.documentElement.lang).toBe('fr');
    expect(base.value).toBe('https://new.example.org/v1');
    expect(apiKey.value).toBe('unsaved-secret');
    expect(openAlexKey.value).toBe('unsaved-openalex');
    expect(consent.checked).toBe(true);
    expect(output.value).toBe('en');
    expect(document.querySelector('#destination')?.textContent).toContain('new.example.org');
    expect(document.querySelector('#status')?.textContent).toContain('chargés');
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'SAVE_SETTINGS')).toBe(false);
    document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })); await flush();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SAVE_SETTINGS', settings: expect.objectContaining({ uiLanguage: 'fr', outputLanguage: 'en', rememberKey: false, consent: true }), apiKey: 'unsaved-secret', openAlexKey: 'unsaved-openalex' }));
    expect(document.querySelector('#status')?.textContent).toContain('enregistrés');
  });

  it('falls back to Chinese for settings saved before language support', async () => {
    fixture();
    const { uiLanguage: _ui, outputLanguage: _output, ...legacy } = view;
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: legacy }) }, permissions: { request: vi.fn() } });
    startOptionsPage(); await flush();
    expect((document.querySelector('#ui-language') as HTMLSelectElement)?.value).toBe('zh-CN');
    expect((document.querySelector('#output-language') as HTMLSelectElement)?.value).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it.each([
    ['fr', 'refusée'],
    ['de', 'nicht erteilt'],
  ])('retains unsaved keys and localizes permission denial in %s', async (language, denial) => {
    fixture();
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: { ...view, uiLanguage: language } });
    const request = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request } });
    startOptionsPage(); await flush();
    (document.querySelector('#api-key') as HTMLInputElement).value = 'unsaved-secret';
    document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })); await flush();
    expect(request).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] });
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'SAVE_SETTINGS')).toBe(false);
    expect((document.querySelector('#api-key') as HTMLInputElement).value).toBe('unsaved-secret');
    expect(document.querySelector('#status')?.textContent).toContain(denial);
    expect(document.querySelector('#status')?.getAttribute('data-state')).toBe('error');
  });

  it('localizes HTTPS validation before requesting any host permission', async () => {
    fixture();
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: { ...view, uiLanguage: 'fr' } });
    const request = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request } });
    startOptionsPage(); await flush();
    (document.querySelector('#base-url') as HTMLInputElement).value = 'http://api.example.com/v1';
    document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })); await flush();
    expect(request).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'SAVE_SETTINGS')).toBe(false);
    expect(document.querySelector('#status')?.textContent).toContain('HTTPS');
    expect(document.querySelector('#status')?.textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect(document.querySelector('#status')?.getAttribute('data-state')).toBe('error');
  });

  it('requires saving language changes before testing the connection', async () => {
    fixture();
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: view });
    vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request: vi.fn().mockResolvedValue(true) } });
    startOptionsPage(); await flush();
    document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })); await flush();
    const ui = document.querySelector('#ui-language') as HTMLSelectElement;
    ui.value = 'de'; ui.dispatchEvent(new Event('change', { bubbles: true }));
    (document.querySelector('#test-connection') as HTMLButtonElement).click(); await flush();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'TEST_CONNECTION')).toBe(false);
    expect(document.querySelector('#status')?.textContent).toContain('Speichern');
  });

  it('shows configured state without ever putting stored keys into inputs', async () => {
    fixture();
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: view }) }, permissions: { request: vi.fn() } });
    startOptionsPage(); await flush();
    expect((document.querySelector('#base-url') as HTMLInputElement).value).toBe(view.baseUrl);
    expect((document.querySelector('#api-key') as HTMLInputElement).value).toBe('');
    expect(document.querySelector('#key-state')?.textContent).toContain('API Key 已设置');
  });

  it('requests only the new HTTPS origin and does not save if permission is denied', async () => {
    fixture();
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: view });
    const request = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request } });
    startOptionsPage(); await flush();
    (document.querySelector('#base-url') as HTMLInputElement).value = 'https://new.example.org/v1';
    (document.querySelector('#model') as HTMLInputElement).value = 'new-model';
    document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })); await flush();
    expect(request).toHaveBeenCalledWith({ origins: ['https://new.example.org/*'] });
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'SAVE_SETTINGS')).toBe(false);
    expect(document.querySelector('#status')?.textContent).toContain('未授予');
  });

  it('revokes consent immediately when the endpoint changes', async () => {
    fixture();
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, data: view }) }, permissions: { request: vi.fn() } });
    startOptionsPage(); await flush();
    const endpoint = document.querySelector('#base-url') as HTMLInputElement;
    const consent = document.querySelector('#consent') as HTMLInputElement;
    expect(consent.checked).toBe(true);
    endpoint.value = 'https://different.example.org/v1'; endpoint.dispatchEvent(new Event('input', { bubbles: true }));
    expect(consent.checked).toBe(false);
    expect(document.querySelector('#destination')?.textContent).toContain('different.example.org');
  });

  it('clears typed key values after a successful save and enables connection testing', async () => {
    fixture();
    const saved = { ...view, baseUrl: 'https://new.example.org/v1', model: 'new-model', hasApiKey: true };
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve({ ok: true, data: message.type === 'GET_SETTINGS' ? view : message.type === 'SAVE_SETTINGS' ? saved : undefined }));
    vi.stubGlobal('chrome', { runtime: { sendMessage }, permissions: { request: vi.fn().mockResolvedValue(true) } });
    startOptionsPage(); await flush();
    const base = document.querySelector('#base-url') as HTMLInputElement; base.value = 'https://new.example.org/v1'; base.dispatchEvent(new Event('input', { bubbles: true }));
    (document.querySelector('#model') as HTMLInputElement).value = 'new-model';
    (document.querySelector('#api-key') as HTMLInputElement).value = 'secret-value';
    (document.querySelector('form') as HTMLFormElement).requestSubmit(); await flush();
    expect((document.querySelector('#api-key') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('#test-connection') as HTMLButtonElement).disabled).toBe(false);
    const model = document.querySelector('#model') as HTMLInputElement;
    model.value = 'changed-without-saving'; model.dispatchEvent(new Event('input', { bubbles: true }));
    (document.querySelector('#test-connection') as HTMLButtonElement).click(); await flush();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'TEST_CONNECTION')).toBe(false);
    expect(document.querySelector('#status')?.textContent).toContain('先保存当前配置');
  });
});
