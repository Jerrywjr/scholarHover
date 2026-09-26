import type { Language } from '../shared/languages.ts';
const zh = {
  pageTitle: '知阅 · 悬停预览', brand: '知阅 ScholarHover', heading: '悬停预览',
  introduction: '开启后，在 HTTPS 网页悬停论文链接即可预览。',
  on: 'ON · 已开启', off: 'OFF · 已关闭', unknown: '正在读取状态…', loading: '正在读取设置与权限…', updating: '正在更新…',
  enabled: '悬停预览已开启。部分网页可能不支持。', disabled: '悬停预览已关闭。',
  access: '开启时需允许访问所有 HTTPS 网站，读取悬停链接的文字，并获取目标链接的论文元数据。',
  privacy: '模型服务仅在你已同意后接收论文标题与可用的摘要，不上传整个网页。',
  offNotice: '关闭后停止新的悬停预览；已保存内容保留，已经请求的任务可能继续完成。',
  support: '适用于支持的 HTTPS 网页；浏览器内置页、内置 PDF 阅读器和限制扩展访问的页面除外。',
  settings: '设置', collection: '已保存论文', retry: '重试',
  denied: '未授予网页访问权限，悬停预览保持关闭。', permissionFailed: '无法请求网页访问权限，悬停预览保持关闭。请重试。',
  loadFailed: '无法读取悬停状态。请重试；当前状态尚未确认。', settingsFailed: '无法读取界面语言，暂用中文。',
  updateFailed: '无法更新悬停状态。开关显示重新读取的状态，请重试。', navigationFailed: '无法打开页面，请重试。',
  revoked: '网页访问权限未授予或已撤销，悬停预览已关闭。',
};
export type PopupMessageKey = keyof typeof zh;
const translations: Record<Language, Record<PopupMessageKey, string>> = {
  'zh-CN': zh,
  en: {
    pageTitle: 'ScholarHover · Hover previews', brand: 'ScholarHover', heading: 'Hover previews', introduction: 'Turn on to preview paper links when hovering on HTTPS websites.',
    on: 'ON · Enabled', off: 'OFF · Disabled', unknown: 'Reading state…', loading: 'Reading settings and access…', updating: 'Updating…', enabled: 'Hover previews are on. Some pages may not support them.', disabled: 'Hover previews are off.',
    access: 'Turning on requires access to read hovered link text on all HTTPS websites and retrieve paper metadata from the destination link.', privacy: 'Only after your existing consent does the model service receive paper titles and available abstracts. Entire pages are not uploaded.', offNotice: 'Turning off stops new hover previews. Saved content stays; jobs already requested may finish.', support: 'Supported HTTPS websites only; browser built-in pages, built-in PDF viewers and pages restricting extensions are excluded.',
    settings: 'Settings', collection: 'Saved papers', retry: 'Retry', denied: 'Website access was denied. Hover previews remain off.', permissionFailed: 'Could not request website access. Hover previews remain off. Retry.', loadFailed: 'Could not read hover state. Retry; the current state is unconfirmed.', settingsFailed: 'Could not read the interface language. Using Chinese for now.', updateFailed: 'Could not update hover state. The switch shows the state read back after the error. Retry.', navigationFailed: 'Could not open the page. Retry.', revoked: 'Website access is missing or revoked. Hover previews are off.',
  },
  fr: {
    pageTitle: 'ScholarHover · Aperçus au survol', brand: 'ScholarHover', heading: 'Aperçus au survol', introduction: 'Activez pour prévisualiser les liens d’articles au survol sur les sites HTTPS.',
    on: 'ON · Activé', off: 'OFF · Désactivé', unknown: 'Lecture de l’état…', loading: 'Lecture des paramètres et autorisations…', updating: 'Mise à jour…', enabled: 'Les aperçus au survol sont activés. Certaines pages peuvent ne pas les prendre en charge.', disabled: 'Les aperçus au survol sont désactivés.',
    access: 'L’activation nécessite l’accès au texte des liens survolés sur tous les sites HTTPS et aux métadonnées des articles à leur destination.', privacy: 'Après votre consentement préalable uniquement, le service de modèle reçoit les titres et les résumés disponibles. Les pages entières ne sont pas envoyées.', offNotice: 'La désactivation arrête les nouveaux aperçus. Le contenu enregistré est conservé ; les tâches déjà demandées peuvent se terminer.', support: 'Sites HTTPS compatibles uniquement ; pages internes du navigateur, lecteurs PDF intégrés et pages interdisant les extensions exclus.',
    settings: 'Paramètres', collection: 'Articles enregistrés', retry: 'Réessayer', denied: 'L’autorisation d’accès aux sites a été refusée. Les aperçus restent désactivés.', permissionFailed: 'Impossible de demander l’accès aux sites. Les aperçus restent désactivés. Réessayez.', loadFailed: 'Impossible de lire l’état des aperçus. Réessayez ; l’état actuel n’est pas confirmé.', settingsFailed: 'Impossible de lire la langue de l’interface. Le chinois est utilisé provisoirement.', updateFailed: 'Impossible de modifier l’état. Le commutateur affiche l’état relu après l’erreur. Réessayez.', navigationFailed: 'Impossible d’ouvrir la page. Réessayez.', revoked: 'L’autorisation d’accès aux sites est absente ou révoquée. Les aperçus sont désactivés.',
  },
  de: {
    pageTitle: 'ScholarHover · Hover-Vorschau', brand: 'ScholarHover', heading: 'Hover-Vorschau', introduction: 'Aktivieren Sie die Vorschau von Artikellinks beim Darüberfahren auf HTTPS-Websites.',
    on: 'ON · Aktiviert', off: 'OFF · Deaktiviert', unknown: 'Status wird gelesen…', loading: 'Einstellungen und Berechtigungen werden gelesen…', updating: 'Wird aktualisiert…', enabled: 'Die Hover-Vorschau ist aktiviert. Manche Seiten unterstützen sie möglicherweise nicht.', disabled: 'Die Hover-Vorschau ist deaktiviert.',
    access: 'Die Aktivierung benötigt Zugriff auf den Text von Links unter dem Mauszeiger auf allen HTTPS-Websites und auf Artikelmetadaten am Linkziel.', privacy: 'Der Modelldienst erhält nur nach Ihrer bestehenden Zustimmung Artikeltitel und verfügbare Abstracts. Ganze Webseiten werden nicht hochgeladen.', offNotice: 'Die Deaktivierung stoppt neue Vorschauen. Gespeicherte Inhalte bleiben erhalten; bereits angeforderte Aufgaben können noch abgeschlossen werden.', support: 'Nur unterstützte HTTPS-Websites; interne Browserseiten, integrierte PDF-Anzeigen und Seiten mit Erweiterungssperren sind ausgeschlossen.',
    settings: 'Einstellungen', collection: 'Gespeicherte Artikel', retry: 'Erneut versuchen', denied: 'Der Websitezugriff wurde nicht erteilt. Die Vorschau bleibt deaktiviert.', permissionFailed: 'Websitezugriff konnte nicht angefordert werden. Die Vorschau bleibt deaktiviert. Versuchen Sie es erneut.', loadFailed: 'Der Vorschauzustand konnte nicht gelesen werden. Versuchen Sie es erneut; der aktuelle Status ist unbestätigt.', settingsFailed: 'Die Oberflächensprache konnte nicht gelesen werden. Vorläufig wird Chinesisch verwendet.', updateFailed: 'Der Status konnte nicht aktualisiert werden. Der Schalter zeigt den nach dem Fehler erneut gelesenen Status. Versuchen Sie es erneut.', navigationFailed: 'Die Seite konnte nicht geöffnet werden. Versuchen Sie es erneut.', revoked: 'Websitezugriff fehlt oder wurde widerrufen. Die Vorschau ist deaktiviert.',
  },
};
export function popupMessage(language: Language, key: PopupMessageKey): string { return translations[language][key]; }
