import { DEFAULT_SETTINGS } from '../shared/defaults';
import { LANGUAGES, type Language } from '../shared/languages';
import type { Credentials, Settings, SettingsView } from '../shared/types';

const SETTINGS_KEY = 'settings';
const API_KEY = 'apiKey';
const OPENALEX_KEY = 'openAlexKey';
type CredentialName = typeof API_KEY | typeof OPENALEX_KEY;

function storageArea(name: 'local' | 'session') {
  return chrome.storage[name] as chrome.storage.StorageArea & {
    setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void>;
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asLanguage(value: unknown): Language {
  return LANGUAGES.includes(value as Language) ? value as Language : 'zh-CN';
}

function normalizeSettings(value: unknown): Settings {
  const stored = value && typeof value === 'object' ? value as Partial<Settings> : {};
  return {
    uiLanguage: asLanguage(stored.uiLanguage),
    outputLanguage: asLanguage(stored.outputLanguage),
    baseUrl: asString(stored.baseUrl).trim().replace(/\/+$/, ''),
    model: asString(stored.model).trim(),
    autoGenerate: asBoolean(stored.autoGenerate, DEFAULT_SETTINGS.autoGenerate),
    consent: asBoolean(stored.consent, DEFAULT_SETTINGS.consent),
    rememberKey: asBoolean(stored.rememberKey, DEFAULT_SETTINGS.rememberKey),
  };
}

export function validateBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) return '';
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('API 地址必须为不含参数的 HTTPS 地址');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || normalized.includes('?') || normalized.includes('#')) {
    throw new Error('API 地址必须为不含参数的 HTTPS 地址');
  }
  return normalized;
}

async function storedSettings(): Promise<Settings> {
  const values = await storageArea('local').get(SETTINGS_KEY);
  return normalizeSettings(values[SETTINGS_KEY]);
}

async function allCredentialValues(): Promise<Record<CredentialName, { local: string; session: string }>> {
  const [local, session] = await Promise.all([
    storageArea('local').get([API_KEY, OPENALEX_KEY]),
    storageArea('session').get([API_KEY, OPENALEX_KEY]),
  ]);
  return {
    [API_KEY]: { local: asString(local[API_KEY]), session: asString(session[API_KEY]) },
    [OPENALEX_KEY]: { local: asString(local[OPENALEX_KEY]), session: asString(session[OPENALEX_KEY]) },
  };
}

function chosenCredential(
  values: { local: string; session: string },
  oldRememberKey: boolean,
  replacement: string | undefined,
): string {
  const supplied = replacement?.trim();
  if (supplied) return supplied;
  const preferred = oldRememberKey ? values.local : values.session;
  return preferred || (oldRememberKey ? values.session : values.local);
}

function endpointOrigin(baseUrl: string): string {
  try {
    const normalized = validateBaseUrl(baseUrl);
    return normalized ? new URL(normalized).origin : '';
  } catch {
    return '';
  }
}

export async function initializeStorage(): Promise<void> {
  await Promise.all([
    storageArea('local').setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }),
    storageArea('session').setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
}

export async function readSettings(): Promise<SettingsView> {
  const [settings, credentials] = await Promise.all([storedSettings(), allCredentialValues()]);
  return {
    ...settings,
    hasApiKey: Boolean(credentials[API_KEY].local || credentials[API_KEY].session),
    hasOpenAlexKey: Boolean(credentials[OPENALEX_KEY].local || credentials[OPENALEX_KEY].session),
  };
}

export async function readCredentials(): Promise<Credentials> {
  const [settings, credentials] = await Promise.all([storedSettings(), allCredentialValues()]);
  const selected = settings.rememberKey ? 'local' : 'session';
  const fallback = selected === 'local' ? 'session' : 'local';
  return {
    apiKey: credentials[API_KEY][selected] || credentials[API_KEY][fallback],
    openAlexKey: credentials[OPENALEX_KEY][selected] || credentials[OPENALEX_KEY][fallback],
  };
}

export async function saveSettings(settings: Settings, keys?: { apiKey?: string; openAlexKey?: string }): Promise<SettingsView> {
  const normalized = normalizeSettings(settings);
  normalized.baseUrl = validateBaseUrl(normalized.baseUrl);
  const [previous, credentials] = await Promise.all([storedSettings(), allCredentialValues()]);
  const destination = normalized.rememberKey ? 'local' : 'session';
  const source = destination === 'local' ? 'session' : 'local';
  const targetStore = storageArea(destination);
  const otherStore = storageArea(source);
  const changedOrigin = endpointOrigin(previous.baseUrl) !== endpointOrigin(normalized.baseUrl);
  const apiKey = changedOrigin ? keys?.apiKey?.trim() ?? '' : chosenCredential(credentials[API_KEY], previous.rememberKey, keys?.apiKey);
  const openAlexKey = chosenCredential(credentials[OPENALEX_KEY], previous.rememberKey, keys?.openAlexKey);
  const updates: Record<string, string> = {};
  if (apiKey) updates[API_KEY] = apiKey;
  if (openAlexKey) updates[OPENALEX_KEY] = openAlexKey;

  await storageArea('local').set({ [SETTINGS_KEY]: normalized });
  if (changedOrigin) {
    await Promise.all([
      storageArea('local').remove(API_KEY),
      storageArea('session').remove(API_KEY),
    ]);
  }
  if (Object.keys(updates).length) await targetStore.set(updates);
  await otherStore.remove([API_KEY, OPENALEX_KEY]);
  return readSettings();
}

export async function clearKeys(): Promise<void> {
  await Promise.all([
    storageArea('local').remove([API_KEY, OPENALEX_KEY]),
    storageArea('session').remove([API_KEY, OPENALEX_KEY]),
  ]);
}
