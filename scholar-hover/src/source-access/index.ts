import { LANGUAGES, type Language } from '../shared/languages.ts';
import { normalizeSourceUrl } from '../shared/source-page.ts';
import { rpc } from '../shared/rpc.ts';
import type { SettingsView } from '../shared/types.ts';
import './style.css';

const zh = {
  pageTitle: '知阅 · 原文网站访问', heading: '读取论文原文摘要', website: '请求访问的网站', grant: '允许读取此网站',
  explanation: '允许扩展读取此网站的公开论文页面，提取标题和摘要。权限仅覆盖上方网站，可在浏览器扩展设置中撤销。',
  instructions: '授权后请返回搜索结果，扩展会重新读取这篇论文的摘要。',
  invalid: '无法确认有效的公开 HTTPS 论文地址。请返回搜索结果，重新打开网站授权页。',
  requesting: '请在浏览器提示中确认网站访问权限。',
  granted: '已允许读取此网站。请返回搜索结果，扩展会重新读取摘要；也可以点击卡片中的“重新读取摘要”。',
  denied: '尚未获得网站访问权限。你可以再次点击按钮申请，或返回搜索结果。',
  failed: '无法申请网站访问权限，请重试或返回搜索结果。',
};
type MessageKey = keyof typeof zh;
const messages: Record<Language, Record<MessageKey, string>> = {
  'zh-CN': zh,
  en: {
    pageTitle: 'Scholar Hover · Original website access', heading: 'Read the original paper abstract', website: 'Website requesting access', grant: 'Allow access to this website',
    explanation: 'Allow the extension to read public paper pages on this website and extract titles and abstracts. Access covers only the website shown above and can be revoked in the browser’s extension settings.',
    instructions: 'After granting access, return to the search results. The extension will read this paper’s abstract again.',
    invalid: 'A valid public HTTPS paper URL could not be verified. Return to the search results and open the website access page again.',
    requesting: 'Confirm website access in the browser prompt.',
    granted: 'Website access granted. Return to the search results to read the abstract again, or select “Read abstract again” on the paper card.',
    denied: 'Access was not granted. You can request it again or return to the search results.',
    failed: 'Unable to request website access. Please retry or return to the search results.',
  },
  fr: {
    pageTitle: 'Scholar Hover · Accès au site original', heading: 'Lire le résumé original de l’article', website: 'Site concerné par l’autorisation', grant: 'Autoriser l’accès à ce site',
    explanation: 'Autorisez l’extension à lire les pages publiques d’articles de ce site pour en extraire les titres et résumés. L’accès concerne uniquement le site indiqué et peut être révoqué dans les paramètres des extensions du navigateur.',
    instructions: 'Après autorisation, revenez aux résultats de recherche. L’extension relira le résumé de cet article.',
    invalid: 'Aucune adresse HTTPS publique valide n’a pu être vérifiée. Revenez aux résultats et rouvrez la page d’autorisation.',
    requesting: 'Confirmez l’accès au site dans la fenêtre du navigateur.',
    granted: 'Accès autorisé. Revenez aux résultats pour relire le résumé, ou cliquez sur « Relire le résumé » dans la fiche.',
    denied: 'L’accès n’a pas été autorisé. Vous pouvez le demander à nouveau ou revenir aux résultats.',
    failed: 'Impossible de demander l’accès. Réessayez ou revenez aux résultats de recherche.',
  },
  de: {
    pageTitle: 'Scholar Hover · Zugriff auf die Originalwebsite', heading: 'Originalabstract des Artikels lesen', website: 'Website für diese Berechtigung', grant: 'Zugriff auf diese Website erlauben',
    explanation: 'Erlauben Sie der Erweiterung, öffentliche Artikelseiten dieser Website zu lesen und Titel sowie Abstracts zu extrahieren. Der Zugriff gilt nur für die angezeigte Website und kann in den Erweiterungseinstellungen des Browsers widerrufen werden.',
    instructions: 'Kehren Sie nach der Freigabe zur Suche zurück. Die Erweiterung liest das Abstract dieses Artikels erneut.',
    invalid: 'Keine gültige öffentliche HTTPS-Artikeladresse konnte bestätigt werden. Kehren Sie zur Suche zurück und öffnen Sie die Berechtigungsseite erneut.',
    requesting: 'Bestätigen Sie den Websitezugriff im Browserdialog.',
    granted: 'Websitezugriff erlaubt. Kehren Sie zur Suche zurück, um das Abstract erneut zu lesen, oder wählen Sie „Abstract erneut lesen“ auf der Karte.',
    denied: 'Der Zugriff wurde nicht erlaubt. Sie können ihn erneut anfordern oder zur Suche zurückkehren.',
    failed: 'Der Websitezugriff konnte nicht angefordert werden. Versuchen Sie es erneut oder kehren Sie zur Suche zurück.',
  },
};

/** Only a direct click requests permission; this page never fetches paper or model data. */
export function startSourceAccessPage(): void {
  const grant = document.querySelector<HTMLButtonElement>('#grant-access');
  const status = document.querySelector<HTMLElement>('#access-status');
  const originLabel = document.querySelector<HTMLElement>('#source-origin');
  const urlLabel = document.querySelector<HTMLElement>('#source-url');
  if (!grant || !status || !originLabel || !urlLabel) return;
  let sourceUrl: string | undefined;
  try { sourceUrl = normalizeSourceUrl(decodeURIComponent(window.location.hash.slice(1))); } catch { /* Invalid URL encoding. */ }
  const origin = sourceUrl ? new URL(sourceUrl).origin : undefined;
  let language: Language = 'zh-CN';
  let notice: MessageKey | undefined = origin ? undefined : 'invalid';
  let pending = false, granted = false;
  const render = () => {
    document.documentElement.lang = language;
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
      element.textContent = messages[language][element.dataset.i18n as MessageKey];
    });
    status.textContent = notice ? messages[language][notice] : '';
    status.dataset.state = notice === 'invalid' || notice === 'failed' || notice === 'denied' ? 'error' : 'ok';
    grant.disabled = !origin || pending || granted;
  };
  originLabel.textContent = origin ?? '';
  urlLabel.textContent = sourceUrl ?? '';
  render();
  grant.addEventListener('click', () => {
    if (!origin || pending || granted) return;
    pending = true; notice = 'requesting'; render();
    try {
      // Keep this call in the original user gesture: no await or background RPC first.
      const permission = chrome.permissions.request({ origins: [`${origin}/*`] });
      void permission.then(allowed => {
        granted = allowed; pending = false; notice = allowed ? 'granted' : 'denied'; render();
      }).catch(() => { pending = false; notice = 'failed'; render(); });
    } catch { pending = false; notice = 'failed'; render(); }
  });
  void rpc<SettingsView>({ type: 'GET_SETTINGS' }).then(settings => {
    language = LANGUAGES.includes(settings.uiLanguage) ? settings.uiLanguage : 'zh-CN'; render();
  }).catch(() => { /* The default Chinese instructions remain usable offline. */ });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof document !== 'undefined') startSourceAccessPage();
