import { LANGUAGES, type Language } from '../shared/languages.ts';
import { rpc } from '../shared/rpc.ts';
import type { HoverState, SettingsView } from '../shared/types.ts';
import { popupMessage, type PopupMessageKey } from './messages.ts';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Popup element missing: ${id}`);
  return element as T;
}

export function startPopup(): void {
  const toggle = byId<HTMLButtonElement>('hover-toggle');
  const retry = byId<HTMLButtonElement>('retry');
  const status = byId('status');
  const main = byId('popup');
  let language: Language = 'zh-CN';
  let state: HoverState | undefined;
  let busy = true;
  let statusKey: PopupMessageKey = 'loading';
  let failure = false;
  const message = (key: PopupMessageKey) => popupMessage(language, key);
  const render = () => {
    document.documentElement.lang = language;
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => { element.textContent = message(element.dataset.i18n as PopupMessageKey); });
    const enabled = Boolean(state?.enabled && state.hasAccess);
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.setAttribute('aria-label', message('heading'));
    toggle.textContent = message(state ? enabled ? 'on' : 'off' : 'unknown');
    toggle.disabled = busy || !state;
    main.setAttribute('aria-busy', String(busy));
    retry.hidden = Boolean(state);
    retry.disabled = busy;
    status.textContent = message(statusKey);
    status.dataset.state = failure ? 'error' : 'ok';
  };
  const notice = (key: PopupMessageKey, error = false) => { statusKey = key; failure = error; render(); };
  const load = async () => {
    busy = true; notice('loading');
    const [settings, hover] = await Promise.allSettled([rpc<SettingsView>({ type: 'GET_SETTINGS' }), rpc<HoverState>({ type: 'GET_HOVER_STATE' })]);
    if (settings.status === 'fulfilled' && LANGUAGES.includes(settings.value.uiLanguage)) language = settings.value.uiLanguage;
    if (hover.status === 'fulfilled') {
      state = { hasAccess: hover.value.hasAccess, enabled: hover.value.enabled && hover.value.hasAccess };
      statusKey = settings.status === 'rejected' ? 'settingsFailed' : !state.hasAccess ? 'revoked' : state.enabled ? 'enabled' : 'disabled';
      failure = settings.status === 'rejected';
    } else { state = undefined; statusKey = 'loadFailed'; failure = true; }
    busy = false; render();
  };
  toggle.addEventListener('click', async () => {
    if (busy || !state) return;
    const enabled = !state.enabled;
    busy = true; notice('updating');
    try {
      if (enabled && !state.hasAccess) {
        // Keep this request directly inside the click, before any await, to
        // preserve Chrome's user gesture for optional host permissions.
        let permission: Promise<boolean>;
        try { permission = chrome.permissions.request({ origins: ['https://*/*'] }); }
        catch { notice('permissionFailed', true); return; }
        let granted: boolean;
        try { granted = await permission; }
        catch { notice('permissionFailed', true); return; }
        if (!granted) { notice('denied', true); return; }
      }
      const saved = await rpc<HoverState>({ type: 'SET_HOVER_ENABLED', enabled });
      state = { hasAccess: saved.hasAccess, enabled: saved.enabled && saved.hasAccess };
      notice(!saved.hasAccess && enabled ? 'revoked' : state.enabled ? 'enabled' : 'disabled');
    } catch {
      // A worker can persist the setting before a later operation fails. Read
      // back rather than representing the pre-click state as still current.
      try {
        const observed = await rpc<HoverState>({ type: 'GET_HOVER_STATE' });
        state = { hasAccess: observed.hasAccess, enabled: observed.enabled && observed.hasAccess };
        notice('updateFailed', true);
      } catch { state = undefined; notice('loadFailed', true); }
    }
    finally { busy = false; render(); }
  });
  retry.addEventListener('click', () => { if (!busy) void load(); });
  for (const [id, type] of [['open-settings', 'OPEN_SETTINGS'], ['open-collection', 'OPEN_COLLECTION']] as const) {
    const button = byId<HTMLButtonElement>(id);
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try { await rpc<void>({ type }); }
      catch { notice('navigationFailed', true); }
      finally { button.disabled = false; }
    });
  }
  render(); void load();
}
if (typeof document !== 'undefined' && document.getElementById('popup')) startPopup();
