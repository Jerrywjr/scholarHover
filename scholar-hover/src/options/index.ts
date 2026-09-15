import { rpc } from '../shared/rpc.ts';
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '../shared/languages.ts';
import { localizeError } from '../shared/errors.ts';
import type { Settings, SettingsView } from '../shared/types.ts';
import { optionsMessage, type OptionsMessageKey } from './messages.ts';

type Fields = {
  form: HTMLFormElement;
  uiLanguage: HTMLSelectElement;
  outputLanguage: HTMLSelectElement;
  baseUrl: HTMLInputElement;
  model: HTMLInputElement;
  apiKey: HTMLInputElement;
  openAlexKey: HTMLInputElement;
  rememberKey: HTMLInputElement;
  autoGenerate: HTMLInputElement;
  consent: HTMLInputElement;
  destination: HTMLOutputElement;
  keyState: HTMLElement;
  status: HTMLElement;
  test: HTMLButtonElement;
  clearCache: HTMLButtonElement;
  clearKeys: HTMLButtonElement;
};

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`设置页缺少 ${id}`);
  return element as T;
}

function fields(): Fields {
  return { form: byId('settings-form'), uiLanguage: byId('ui-language'), outputLanguage: byId('output-language'), baseUrl: byId('base-url'), model: byId('model'), apiKey: byId('api-key'), openAlexKey: byId('openalex-key'), rememberKey: byId('remember-key'), autoGenerate: byId('auto-generate'), consent: byId('consent'), destination: byId('destination'), keyState: byId('key-state'), status: byId('status'), test: byId('test-connection'), clearCache: byId('clear-cache'), clearKeys: byId('clear-keys') };
}

function language(value: unknown): Language {
  return LANGUAGES.includes(value as Language) ? value as Language : 'zh-CN';
}

/** UI-side validation intentionally mirrors the background guard before requesting permission. */
export function endpoint(value: string): { value: string; origin: string } | undefined {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) return undefined;
  let url: URL;
  try { url = new URL(normalized); } catch { throw new Error('API 地址必须为不含参数的 HTTPS 地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('API 地址必须为不含参数的 HTTPS 地址');
  return { value: normalized, origin: url.origin };
}

function dataDestination(value: string): string | undefined {
  try { return new URL(value).host; } catch { return undefined; }
}

export function startOptionsPage(): void {
  const f = fields();
  const privacyLink = byId<HTMLAnchorElement>('privacy-policy');
  type Control = HTMLInputElement | HTMLSelectElement;
  const controls: Control[] = [f.uiLanguage, f.outputLanguage, f.baseUrl, f.model, f.apiKey, f.openAlexKey, f.rememberKey, f.autoGenerate, f.consent];
  const controlValue = (control: Control) => control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value;
  const captureControls = () => new Map(controls.map(control => [control, controlValue(control)]));
  const controlsMatch = (snapshot: Map<Control, string | boolean>) => controls.every(control => controlValue(control) === snapshot.get(control));
  const fieldVersions = new Map<Control, number>();
  let editVersion = 0;
  let busy = true;
  let originalEndpoint = '';
  let savedThisVisit = false;
  let dirty = false;
  let uiLanguage: Language = 'zh-CN';
  let keyState: Pick<SettingsView, 'hasApiKey' | 'hasOpenAlexKey'> | undefined;
  let status: { key: OptionsMessageKey; failure: boolean } | { error: string; failure: true } | undefined;
  const message = (key: OptionsMessageKey, values?: Record<string, string>) => optionsMessage(uiLanguage, key, values);
  const renderStatus = () => {
    if (!status) return;
    f.status.textContent = 'error' in status ? localizeError(status.error, uiLanguage) : message(status.key);
    f.status.dataset.state = status.failure ? 'error' : 'ok';
  };
  const setStatus = (key: OptionsMessageKey, failure = false) => { status = { key, failure }; renderStatus(); };
  const setError = (error: unknown) => { status = { error: error instanceof Error ? error.message : '', failure: true }; renderStatus(); };
  const setBusy = (value: boolean) => {
    busy = value;
    f.form.setAttribute('aria-busy', String(value));
    f.form.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = value; });
    f.test.disabled = value || !savedThisVisit;
  };
  const clearUnchangedKeys = (snapshot: Map<Control, string | boolean>, version: number) => {
    for (const field of [f.apiKey, f.openAlexKey]) {
      if (field.value === snapshot.get(field) && (fieldVersions.get(field) ?? 0) <= version) field.value = '';
    }
  };
  const updateDestination = () => { f.destination.textContent = message('destination', { host: dataDestination(f.baseUrl.value) || message('unconfigured') }); };
  const updateKeyState = (settings = keyState) => {
    if (!settings) return;
    keyState = settings;
    f.keyState.textContent = message('keyState', { model: message(settings.hasApiKey ? 'keySet' : 'keyUnset'), openalex: message(settings.hasOpenAlexKey ? 'keySet' : 'keyUnset') });
  };
  const renderLanguage = () => {
    uiLanguage = language(f.uiLanguage.value);
    document.documentElement.lang = uiLanguage;
    privacyLink.setAttribute('href', uiLanguage === 'zh-CN' ? '/PRIVACY.md' : `/PRIVACY.${uiLanguage}.md`);
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
      element.textContent = message(element.dataset.i18n as OptionsMessageKey);
    });
    document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(element => {
      element.placeholder = message(element.dataset.i18nPlaceholder as OptionsMessageKey);
    });
    updateDestination(); updateKeyState(); renderStatus();
  };
  for (const select of [f.uiLanguage, f.outputLanguage]) {
    select.replaceChildren(...LANGUAGES.map(value => {
      const option = document.createElement('option');
      option.value = value; option.lang = value; option.textContent = LANGUAGE_NAMES[value];
      return option;
    }));
    select.value = 'zh-CN';
  }
  renderLanguage();
  const initialValues = captureControls();
  const mergeLoadedValue = (control: Control, value: string | boolean) => {
    if (fieldVersions.has(control) || controlValue(control) !== initialValues.get(control)) return;
    if (typeof value === 'boolean') (control as HTMLInputElement).checked = value;
    else control.value = value;
  };
  const load = async () => {
    try {
      const settings = await rpc<SettingsView>({ type: 'GET_SETTINGS' });
      dirty = editVersion > 0 || !controlsMatch(initialValues);
      originalEndpoint = settings.baseUrl;
      mergeLoadedValue(f.uiLanguage, language(settings.uiLanguage)); mergeLoadedValue(f.outputLanguage, language(settings.outputLanguage));
      mergeLoadedValue(f.baseUrl, settings.baseUrl); mergeLoadedValue(f.model, settings.model);
      mergeLoadedValue(f.rememberKey, settings.rememberKey); mergeLoadedValue(f.autoGenerate, settings.autoGenerate);
      mergeLoadedValue(f.consent, settings.consent && f.baseUrl.value.trim().replace(/\/+$/, '') === originalEndpoint);
      updateKeyState(settings); renderLanguage();
      setStatus('loaded');
    } catch { setStatus('loadFailed', true); }
    finally { setBusy(false); }
  };
  f.uiLanguage.addEventListener('change', renderLanguage);
  f.baseUrl.addEventListener('input', () => {
    dirty = true;
    updateDestination();
    if (f.baseUrl.value.trim().replace(/\/+$/, '') !== originalEndpoint) f.consent.checked = false;
  });
  const recordEdit = (event: Event) => {
    if (!controls.includes(event.target as Control)) return;
    fieldVersions.set(event.target as Control, ++editVersion);
    dirty = true;
  };
  f.form.addEventListener('input', recordEdit);
  f.form.addEventListener('change', recordEdit);
  f.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    // Read every submitted value before requesting permission. The user can keep
    // editing while awaiting Chrome or the worker, but this request stays fixed.
    const submittedValues = captureControls();
    const submittedVersion = editVersion;
    let requested: { value: string; origin: string } | undefined;
    try { requested = endpoint(f.baseUrl.value); } catch (error) { setError(error); return; }
    const settings: Settings = { uiLanguage: language(f.uiLanguage.value), outputLanguage: language(f.outputLanguage.value), baseUrl: requested?.value ?? '', model: f.model.value.trim(), rememberKey: f.rememberKey.checked, autoGenerate: f.autoGenerate.checked, consent: f.consent.checked };
    const apiKey = f.apiKey.value;
    const openAlexKey = f.openAlexKey.value;
    setBusy(true);
    try {
      if (requested) {
        let granted = false;
        try { granted = await chrome.permissions.request({ origins: [`${requested.origin}/*`] }); }
        catch { setStatus('permissionFailed', true); return; }
        if (!granted) { setStatus('permissionDenied', true); return; }
      }
      const saved = await rpc<SettingsView>({ type: 'SAVE_SETTINGS', settings, ...(apiKey ? { apiKey } : {}), ...(openAlexKey ? { openAlexKey } : {}) });
      originalEndpoint = saved.baseUrl; savedThisVisit = true;
      dirty = editVersion !== submittedVersion || !controlsMatch(submittedValues);
      clearUnchangedKeys(submittedValues, submittedVersion);
      updateKeyState(saved); updateDestination();
      setStatus(dirty ? 'saveBeforeTest' : 'saved');
    } catch (error) { setError(error); }
    finally { setBusy(false); }
  });
  f.test.addEventListener('click', async () => {
    if (busy) return;
    if (!savedThisVisit || dirty) { setStatus('saveBeforeTest', true); return; }
    setBusy(true); setStatus('testing');
    try { await rpc<void>({ type: 'TEST_CONNECTION' }); setStatus(dirty ? 'saveBeforeTest' : 'tested'); }
    catch (error) { setError(error); }
    finally { setBusy(false); }
  });
  f.clearCache.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try { await rpc<void>({ type: 'CLEAR_CACHE' }); setStatus('cacheCleared'); }
    catch (error) { setError(error); }
    finally { setBusy(false); }
  });
  f.clearKeys.addEventListener('click', async () => {
    if (busy) return;
    const submittedValues = captureControls();
    const submittedVersion = editVersion;
    setBusy(true);
    try { await rpc<void>({ type: 'CLEAR_KEYS' }); clearUnchangedKeys(submittedValues, submittedVersion); updateKeyState({ hasApiKey: false, hasOpenAlexKey: false }); setStatus('keysCleared'); }
    catch (error) { setError(error); }
    finally { setBusy(false); }
  });
  setBusy(true);
  void load();
}

if (typeof document !== 'undefined' && document.getElementById('settings-form')) startOptionsPage();
