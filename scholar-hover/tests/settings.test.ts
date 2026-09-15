import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/defaults';
import { clearKeys, initializeStorage, readCredentials, readSettings, saveSettings } from '../src/background/settings';
import { installChromeStorage } from './chrome-storage';

describe('settings storage', () => {
  beforeEach(() => installChromeStorage());

  it('initializes local and session storage for trusted extension contexts', async () => {
    const storage = installChromeStorage();
    await initializeStorage();
    expect(storage.accessLevels).toEqual(['TRUSTED_CONTEXTS', 'TRUSTED_CONTEXTS']);
  });

  it('returns safe defaults and never exposes credentials in the settings view', async () => {
    const storage = installChromeStorage({ settings: { baseUrl: 'https://api.example.com/v1', model: 'm' }, apiKey: 'local-secret' }, { openAlexKey: 'session-secret' });
    expect(await readSettings()).toEqual({ ...DEFAULT_SETTINGS, baseUrl: 'https://api.example.com/v1', model: 'm', hasApiKey: true, hasOpenAlexKey: true });
    expect(storage.local.settings).not.toHaveProperty('apiKey');
  });

  it.each([
    { uiLanguage: undefined, outputLanguage: undefined },
    { uiLanguage: 'es', outputLanguage: 'fr-FR' },
    { uiLanguage: 123, outputLanguage: null },
  ])('defaults absent or invalid languages to Chinese without changing credential stores: %j', async (languages) => {
    const storage = installChromeStorage({ settings: { baseUrl: 'https://api.example.com/v1', model: 'm', rememberKey: true, ...languages }, apiKey: 'local-api' }, { openAlexKey: 'session-openalex' });
    expect(await readSettings()).toMatchObject({ uiLanguage: 'zh-CN', outputLanguage: 'zh-CN', hasApiKey: true, hasOpenAlexKey: true });
    expect(await readCredentials()).toEqual({ apiKey: 'local-api', openAlexKey: 'session-openalex' });
    expect(storage.local.apiKey).toBe('local-api');
    expect(storage.session.openAlexKey).toBe('session-openalex');
    expect(storage.chromeMock.storage.local.set).not.toHaveBeenCalled();
    expect(storage.chromeMock.storage.session.set).not.toHaveBeenCalled();
  });

  it.each(['zh-CN', 'en', 'fr', 'de'] as const)('persists independent language settings and retains existing credentials when selecting %s', async (language) => {
    const previous = { ...DEFAULT_SETTINGS, baseUrl: 'https://api.example.com/v1', model: 'm', rememberKey: true };
    const storage = installChromeStorage({ settings: previous, apiKey: 'api', openAlexKey: 'openalex' });
    const saved = await saveSettings({ ...previous, uiLanguage: language, outputLanguage: 'de' });
    expect(saved).toMatchObject({ uiLanguage: language, outputLanguage: 'de', hasApiKey: true, hasOpenAlexKey: true });
    expect(storage.local.settings).toMatchObject({ uiLanguage: language, outputLanguage: 'de' });
    expect(await readCredentials()).toEqual({ apiKey: 'api', openAlexKey: 'openalex' });
  });

  it('keeps keys in session by default and moves existing keys when remember mode changes', async () => {
    const storage = installChromeStorage();
    await saveSettings({ ...DEFAULT_SETTINGS, baseUrl: 'https://api.example.com/v1', model: 'm', rememberKey: false }, { apiKey: 'api', openAlexKey: 'openalex' });
    expect(storage.session).toMatchObject({ apiKey: 'api', openAlexKey: 'openalex' });
    expect(storage.local).not.toHaveProperty('apiKey');

    await saveSettings({ ...DEFAULT_SETTINGS, baseUrl: 'https://api.example.com/v1', model: 'm', rememberKey: true });
    expect(storage.local).toMatchObject({ apiKey: 'api', openAlexKey: 'openalex' });
    expect(storage.session).not.toHaveProperty('apiKey');
    expect(await readCredentials()).toEqual({ apiKey: 'api', openAlexKey: 'openalex' });
  });

  it('rejects unsafe API base URLs', async () => {
    for (const baseUrl of ['http://api.example.com/v1', 'https://key@api.example.com/v1', 'https://api.example.com/v1?target=x', 'https://api.example.com/v1?', 'https://api.example.com/v1#fragment']) {
      await expect(saveSettings({ ...DEFAULT_SETTINGS, baseUrl, model: 'm' })).rejects.toThrow(/HTTPS/);
    }
  });

  it('removes keys from both stores', async () => {
    const storage = installChromeStorage({ apiKey: 'local' }, { apiKey: 'session', openAlexKey: 'openalex' });
    await clearKeys();
    expect(storage.local).not.toHaveProperty('apiKey');
    expect(storage.session).not.toHaveProperty('apiKey');
    expect(storage.session).not.toHaveProperty('openAlexKey');
  });

  it('clears the provider key when the API origin changes unless a new key is supplied', async () => {
    const storage = installChromeStorage({ settings: { baseUrl: 'https://old.example.com/v1', model: 'm', rememberKey: true }, apiKey: 'old-key' });
    await saveSettings({ ...DEFAULT_SETTINGS, baseUrl: 'https://new.example.com/v1', model: 'm', rememberKey: true });
    expect(storage.local).not.toHaveProperty('apiKey');
    expect(await readCredentials()).toEqual({ apiKey: '', openAlexKey: '' });

    await saveSettings({ ...DEFAULT_SETTINGS, baseUrl: 'https://next.example.com/v1', model: 'm', rememberKey: false }, { apiKey: 'new-key' });
    expect(await readCredentials()).toEqual({ apiKey: 'new-key', openAlexKey: '' });
  });
});
