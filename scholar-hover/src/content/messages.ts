import type { Language } from '../shared/languages.ts';

const zh = {
  pin: '固定', unpin: '取消固定', close: '关闭', source: '来源', model: '模型', recordLink: '记录链接', crossrefAbstract: 'Crossref · 摘要',
  dragHint: '拖动标题栏移动 · 自动固定', contents: '论文内容，可滚动', retryGenerate: '重试生成{language}信息',
  matched: '已匹配文献记录。', resolving: '正在核对公开文献记录…', chooseMatch: '请选择匹配条目', uncertain: '匹配不确定，请确认条目。',
  abstract: '摘要', noAbstract: '暂无摘要', expandAbstract: '展开原文摘要与{language}翻译', summary: '摘要要点（基于论文摘要）',
  openOriginal: '打开原始页面', copy: '复制信息', generate: '生成{language}信息', settings: '设置',
  generating: '正在生成{language}信息…', generated: '{language}信息已生成。', generationFailed: '生成失败，请稍后手动重试。',
  queryFailed: '文献查询失败。', cached: '已读取本地缓存。', pinned: '卡片已固定。', unpinned: '卡片已取消固定。',
  settingsFailed: '无法打开设置页面。', copyUnavailable: '此浏览器无法访问剪贴板，请手动复制。', copied: '已复制到剪贴板。',
  copyFailed: '复制失败，请检查浏览器权限。', confirming: '正在确认匹配…', confirmed: '已确认匹配。', confirmFailed: '确认失败。',
  outputChanged: '输出语言已变化，请重新生成。',
};

export type ContentMessageKey = keyof typeof zh;
const messages: Record<Language, Record<ContentMessageKey, string>> = {
  'zh-CN': zh,
  en: {
    pin: 'Pin', unpin: 'Unpin', close: 'Close', source: 'Source', model: 'Model', recordLink: 'Record link', crossrefAbstract: 'Crossref · Abstract',
    dragHint: 'Drag the header to move · Pins automatically', contents: 'Paper content, scrollable', retryGenerate: 'Retry {language} generation',
    matched: 'Literature record matched.', resolving: 'Checking public literature records…', chooseMatch: 'Choose the matching record', uncertain: 'Match uncertain. Please confirm a record.',
    abstract: 'Abstract', noAbstract: 'No abstract available', expandAbstract: 'Show original abstract and {language} translation', summary: 'Key points (based on the paper abstract)',
    openOriginal: 'Open original page', copy: 'Copy information', generate: 'Generate {language} text', settings: 'Settings',
    generating: 'Generating {language} text…', generated: '{language} text generated.', generationFailed: 'Generation failed. Please retry manually later.',
    queryFailed: 'Literature lookup failed.', cached: 'Loaded from local cache.', pinned: 'Card pinned.', unpinned: 'Card unpinned.',
    settingsFailed: 'Unable to open settings.', copyUnavailable: 'Clipboard access is unavailable in this browser. Please copy manually.', copied: 'Copied to clipboard.',
    copyFailed: 'Copy failed. Please check browser permissions.', confirming: 'Confirming the match…', confirmed: 'Match confirmed.', confirmFailed: 'Confirmation failed.',
    outputChanged: 'The output language changed. Please generate again.',
  },
  fr: {
    pin: 'Épingler', unpin: 'Détacher', close: 'Fermer', source: 'Source', model: 'Modèle', recordLink: 'Lien vers la notice', crossrefAbstract: 'Crossref · Résumé',
    dragHint: 'Faites glisser l’en-tête · Épinglage automatique', contents: 'Contenu de l’article, défilable', retryGenerate: 'Réessayer en {language}',
    matched: 'Notice bibliographique trouvée.', resolving: 'Vérification des notices bibliographiques publiques…', chooseMatch: 'Choisissez la notice correspondante', uncertain: 'Correspondance incertaine. Veuillez confirmer une notice.',
    abstract: 'Résumé', noAbstract: 'Aucun résumé disponible', expandAbstract: 'Afficher le résumé original et la traduction en {language}', summary: 'Points clés (d’après le résumé de l’article)',
    openOriginal: 'Ouvrir la page originale', copy: 'Copier les informations', generate: 'Générer le texte en {language}', settings: 'Paramètres',
    generating: 'Génération du texte en {language}…', generated: 'Texte en {language} généré.', generationFailed: 'La génération a échoué. Veuillez réessayer manuellement plus tard.',
    queryFailed: 'La recherche bibliographique a échoué.', cached: 'Chargé depuis le cache local.', pinned: 'Fiche épinglée.', unpinned: 'Fiche détachée.',
    settingsFailed: 'Impossible d’ouvrir les paramètres.', copyUnavailable: 'Le presse-papiers est inaccessible dans ce navigateur. Veuillez copier manuellement.', copied: 'Copié dans le presse-papiers.',
    copyFailed: 'La copie a échoué. Vérifiez les autorisations du navigateur.', confirming: 'Confirmation de la correspondance…', confirmed: 'Correspondance confirmée.', confirmFailed: 'La confirmation a échoué.',
    outputChanged: 'La langue de sortie a changé. Veuillez relancer la génération.',
  },
  de: {
    pin: 'Anheften', unpin: 'Loslösen', close: 'Schließen', source: 'Quelle', model: 'Modell', recordLink: 'Link zum Eintrag', crossrefAbstract: 'Crossref · Abstract',
    dragHint: 'Titelleiste ziehen · Automatisch angeheftet', contents: 'Artikelinhalt, scrollbar', retryGenerate: 'Erneut auf {language} erzeugen',
    matched: 'Literatureintrag gefunden.', resolving: 'Öffentliche Literaturdaten werden geprüft…', chooseMatch: 'Passenden Eintrag auswählen', uncertain: 'Zuordnung unsicher. Bitte bestätigen Sie einen Eintrag.',
    abstract: 'Abstract', noAbstract: 'Kein Abstract verfügbar', expandAbstract: 'Originalabstract und Übersetzung auf {language} anzeigen', summary: 'Kernaussagen (auf Grundlage des Abstracts)',
    openOriginal: 'Originalseite öffnen', copy: 'Informationen kopieren', generate: 'Text auf {language} erzeugen', settings: 'Einstellungen',
    generating: 'Text auf {language} wird erzeugt…', generated: 'Text auf {language} erzeugt.', generationFailed: 'Die Texterzeugung ist fehlgeschlagen. Bitte versuchen Sie es später manuell erneut.',
    queryFailed: 'Die Literatursuche ist fehlgeschlagen.', cached: 'Aus dem lokalen Cache geladen.', pinned: 'Karte angeheftet.', unpinned: 'Karte losgelöst.',
    settingsFailed: 'Einstellungen konnten nicht geöffnet werden.', copyUnavailable: 'Der Browser erlaubt keinen Zugriff auf die Zwischenablage. Bitte kopieren Sie den Text manuell.', copied: 'In die Zwischenablage kopiert.',
    copyFailed: 'Kopieren fehlgeschlagen. Bitte prüfen Sie die Browserberechtigungen.', confirming: 'Zuordnung wird bestätigt…', confirmed: 'Zuordnung bestätigt.', confirmFailed: 'Bestätigung fehlgeschlagen.',
    outputChanged: 'Die Ausgabesprache hat sich geändert. Bitte erzeugen Sie den Text erneut.',
  },
};

const languageNames: Record<Language, Record<Language, string>> = {
  'zh-CN': { 'zh-CN': '中文', en: '英文', fr: '法文', de: '德文' },
  en: { 'zh-CN': 'Chinese', en: 'English', fr: 'French', de: 'German' },
  fr: { 'zh-CN': 'chinois', en: 'anglais', fr: 'français', de: 'allemand' },
  de: { 'zh-CN': 'Chinesisch', en: 'Englisch', fr: 'Französisch', de: 'Deutsch' },
};

export function contentText(key: ContentMessageKey, uiLanguage: Language, outputLanguage: Language): string {
  return messages[uiLanguage][key].replace('{language}', languageNames[uiLanguage][outputLanguage]);
}
