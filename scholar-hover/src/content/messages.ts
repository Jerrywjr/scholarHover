import type { Language } from '../shared/languages.ts';

const zh = {
  pin: '固定', unpin: '取消固定', close: '关闭', source: '来源', model: '模型', recordLink: '记录链接', crossrefAbstract: 'Crossref · 摘要',
  originalSource: '原文页面', retryMetadata: '重新读取摘要', readingAbstract: '正在读取原文摘要…', sourceAccess: '允许读取原文网站', sourceAccessOpened: '已打开网站授权页；返回搜索结果后会重新读取摘要。', sourceAccessFailed: '无法打开网站授权页。', noMatch: '暂未找到可验证的文献记录。',
  resizeHint: '拖动上下边框调整高度', resizeTop: '调整上边框（方向键微调，End 恢复全高）', resizeBottom: '调整下边框（方向键微调，End 恢复全高）', fullHeight: '恢复全高',
  save: '缓存本文', saving: '正在缓存…', savedButton: '已缓存 · 更新', saved: '已缓存，可在“下载缓存文章”中管理和导出。', savedUnresolved: '已缓存页面信息；匹配尚未确认。', saveFailed: '缓存失败，请重试。', collection: '下载缓存文章', collectionOpening: '正在打开缓存文章…', collectionOpened: '已打开缓存文章管理页。', collectionFailed: '无法打开缓存文章管理页。', contents: '论文内容，可滚动', retryGenerate: '重试生成{language}信息',
  matched: '已匹配文献记录。', resolving: '正在核对公开文献记录…', chooseMatch: '请选择匹配条目', uncertain: '匹配不确定，请确认条目。',
  abstract: '摘要', noAbstract: '暂无摘要', expandAbstract: '展开原文摘要与{language}翻译', summary: '摘要要点（基于论文摘要）',
  openOriginal: '打开原始页面', copy: '复制信息', generate: '生成{language}信息', settings: '设置',
  generating: '正在生成{language}信息…', generated: '{language}信息已生成。', generationFailed: '生成失败，请稍后手动重试。',
  queryFailed: '文献查询失败。', cached: '已读取本地缓存。', pinned: '卡片已固定。', unpinned: '卡片已取消固定。',
  settingsFailed: '无法打开设置页面。', copyUnavailable: '此浏览器无法访问剪贴板，请手动复制。', copied: '已复制到剪贴板。',
  copyFailed: '复制失败，请检查浏览器权限。', confirming: '正在确认匹配…', confirmed: '已确认匹配。', confirmFailed: '确认失败。',
  outputChanged: '输出语言已变化，请重新生成。',
  previewFailed: '无法读取本地预览；已显示的信息仍保留，请重新打开卡片重试。', unviewed: '未查看', viewed: '已查看', savedBadge: '已缓存', cachedWarning: '生成成功，但本地预览存档未能保存。',
  completionQueued: '已缓存，后台等待补全文献信息与译文。', completionResolving: '已缓存，正在后台核对文献；可继续浏览其他文章。', completionGenerating: '已缓存，正在后台生成译文与摘要要点。', completionReady: '已缓存，信息补全完成。', completionConfirm: '已缓存，请确认匹配条目后继续补全。', completionConfigure: '已缓存，请配置模型服务后在缓存管理页重试补全。', completionFailed: '已缓存，但后台补全失败；可在缓存管理页重试。', completionInterrupted: '已缓存，后台补全已中断；可在缓存管理页重试。',
};

export type ContentMessageKey = keyof typeof zh;
const messages: Record<Language, Record<ContentMessageKey, string>> = {
  'zh-CN': zh,
  en: {
    pin: 'Pin', unpin: 'Unpin', close: 'Close', source: 'Source', model: 'Model', recordLink: 'Record link', crossrefAbstract: 'Crossref · Abstract',
    originalSource: 'Original page', retryMetadata: 'Read abstract again', readingAbstract: 'Reading the original abstract…', sourceAccess: 'Allow access to the original website', sourceAccessOpened: 'Website access page opened. Return to the search results to read the abstract again.', sourceAccessFailed: 'Unable to open the website access page.', noMatch: 'No verifiable literature record found yet.',
    resizeHint: 'Drag the top or bottom edge to resize', resizeTop: 'Resize top edge (arrow keys adjust, End restores full height)', resizeBottom: 'Resize bottom edge (arrow keys adjust, End restores full height)', fullHeight: 'Full height',
    save: 'Save paper', saving: 'Saving…', savedButton: 'Saved · Update', saved: 'Saved. Manage and export it in Download saved papers.', savedUnresolved: 'Page information saved; the match is not confirmed.', saveFailed: 'Unable to save. Please retry.', collection: 'Download saved papers', collectionOpening: 'Opening saved papers…', collectionOpened: 'Saved papers opened.', collectionFailed: 'Unable to open saved papers.', contents: 'Paper content, scrollable', retryGenerate: 'Retry {language} generation',
    matched: 'Literature record matched.', resolving: 'Checking public literature records…', chooseMatch: 'Choose the matching record', uncertain: 'Match uncertain. Please confirm a record.',
    abstract: 'Abstract', noAbstract: 'No abstract available', expandAbstract: 'Show original abstract and {language} translation', summary: 'Key points (based on the paper abstract)',
    openOriginal: 'Open original page', copy: 'Copy information', generate: 'Generate {language} text', settings: 'Settings',
    generating: 'Generating {language} text…', generated: '{language} text generated.', generationFailed: 'Generation failed. Please retry manually later.',
    queryFailed: 'Literature lookup failed.', cached: 'Loaded from local cache.', pinned: 'Card pinned.', unpinned: 'Card unpinned.',
    settingsFailed: 'Unable to open settings.', copyUnavailable: 'Clipboard access is unavailable in this browser. Please copy manually.', copied: 'Copied to clipboard.',
    copyFailed: 'Copy failed. Please check browser permissions.', confirming: 'Confirming the match…', confirmed: 'Match confirmed.', confirmFailed: 'Confirmation failed.',
    outputChanged: 'The output language changed. Please generate again.',
    previewFailed: 'Unable to read the local preview. Displayed information is retained; reopen the card to retry.', unviewed: 'Not viewed', viewed: 'Viewed', savedBadge: 'Saved', cachedWarning: 'Generation succeeded, but the local preview archive could not be saved.',
    completionQueued: 'Saved. Metadata and translation are queued in the background.', completionResolving: 'Saved. Checking metadata in the background; you can continue browsing.', completionGenerating: 'Saved. Generating translation and key points in the background.', completionReady: 'Saved. Information is complete.', completionConfirm: 'Saved. Confirm a matching record to continue.', completionConfigure: 'Saved. Configure the model, then retry completion in saved papers.', completionFailed: 'Saved, but background completion failed. Retry in saved papers.', completionInterrupted: 'Saved. Background completion was interrupted. Retry in saved papers.',
  },
  fr: {
    pin: 'Épingler', unpin: 'Détacher', close: 'Fermer', source: 'Source', model: 'Modèle', recordLink: 'Lien vers la notice', crossrefAbstract: 'Crossref · Résumé',
    originalSource: 'Page originale', retryMetadata: 'Relire le résumé', readingAbstract: 'Lecture du résumé original…', sourceAccess: 'Autoriser l’accès au site original', sourceAccessOpened: 'Page d’autorisation ouverte. Revenez aux résultats pour relire le résumé.', sourceAccessFailed: 'Impossible d’ouvrir la page d’autorisation.', noMatch: 'Aucune notice bibliographique vérifiable trouvée pour le moment.',
    resizeHint: 'Faites glisser le bord supérieur ou inférieur', resizeTop: 'Redimensionner le bord supérieur (flèches ; Fin pour toute la hauteur)', resizeBottom: 'Redimensionner le bord inférieur (flèches ; Fin pour toute la hauteur)', fullHeight: 'Toute la hauteur',
    save: 'Enregistrer l’article', saving: 'Enregistrement…', savedButton: 'Enregistré · Actualiser', saved: 'Enregistré. Gérez et exportez l’article dans les articles enregistrés.', savedUnresolved: 'Informations de la page enregistrées ; correspondance non confirmée.', saveFailed: 'Échec de l’enregistrement. Veuillez réessayer.', collection: 'Télécharger les articles enregistrés', collectionOpening: 'Ouverture des articles enregistrés…', collectionOpened: 'Les articles enregistrés sont ouverts.', collectionFailed: 'Impossible d’ouvrir les articles enregistrés.', contents: 'Contenu de l’article, défilable', retryGenerate: 'Réessayer en {language}',
    matched: 'Notice bibliographique trouvée.', resolving: 'Vérification des notices bibliographiques publiques…', chooseMatch: 'Choisissez la notice correspondante', uncertain: 'Correspondance incertaine. Veuillez confirmer une notice.',
    abstract: 'Résumé', noAbstract: 'Aucun résumé disponible', expandAbstract: 'Afficher le résumé original et la traduction en {language}', summary: 'Points clés (d’après le résumé de l’article)',
    openOriginal: 'Ouvrir la page originale', copy: 'Copier les informations', generate: 'Générer le texte en {language}', settings: 'Paramètres',
    generating: 'Génération du texte en {language}…', generated: 'Texte en {language} généré.', generationFailed: 'La génération a échoué. Veuillez réessayer manuellement plus tard.',
    queryFailed: 'La recherche bibliographique a échoué.', cached: 'Chargé depuis le cache local.', pinned: 'Fiche épinglée.', unpinned: 'Fiche détachée.',
    settingsFailed: 'Impossible d’ouvrir les paramètres.', copyUnavailable: 'Le presse-papiers est inaccessible dans ce navigateur. Veuillez copier manuellement.', copied: 'Copié dans le presse-papiers.',
    copyFailed: 'La copie a échoué. Vérifiez les autorisations du navigateur.', confirming: 'Confirmation de la correspondance…', confirmed: 'Correspondance confirmée.', confirmFailed: 'La confirmation a échoué.',
    outputChanged: 'La langue de sortie a changé. Veuillez relancer la génération.',
    previewFailed: 'Impossible de lire l’aperçu local. Les informations affichées sont conservées ; rouvrez la fiche pour réessayer.', unviewed: 'Non consulté', viewed: 'Consulté', savedBadge: 'Enregistré', cachedWarning: 'Le texte a été généré, mais l’aperçu local n’a pas pu être enregistré.',
    completionQueued: 'Enregistré. Les métadonnées et la traduction sont en attente.', completionResolving: 'Enregistré. Vérification en arrière-plan ; vous pouvez poursuivre votre recherche.', completionGenerating: 'Enregistré. Traduction et points clés en cours en arrière-plan.', completionReady: 'Enregistré. Informations complétées.', completionConfirm: 'Enregistré. Confirmez une notice pour continuer.', completionConfigure: 'Enregistré. Configurez le modèle, puis réessayez dans les articles enregistrés.', completionFailed: 'Enregistré, mais le traitement a échoué. Réessayez dans les articles enregistrés.', completionInterrupted: 'Enregistré. Traitement interrompu ; réessayez dans les articles enregistrés.',
  },
  de: {
    pin: 'Anheften', unpin: 'Loslösen', close: 'Schließen', source: 'Quelle', model: 'Modell', recordLink: 'Link zum Eintrag', crossrefAbstract: 'Crossref · Abstract',
    originalSource: 'Originalseite', retryMetadata: 'Abstract erneut lesen', readingAbstract: 'Originalabstract wird gelesen…', sourceAccess: 'Zugriff auf die Originalwebsite erlauben', sourceAccessOpened: 'Die Berechtigungsseite ist geöffnet. Kehren Sie zur Suche zurück, um das Abstract erneut zu lesen.', sourceAccessFailed: 'Die Berechtigungsseite konnte nicht geöffnet werden.', noMatch: 'Noch kein überprüfbarer Literatureintrag gefunden.',
    resizeHint: 'Oberen oder unteren Rand zum Anpassen ziehen', resizeTop: 'Oberen Rand anpassen (Pfeiltasten; Ende für volle Höhe)', resizeBottom: 'Unteren Rand anpassen (Pfeiltasten; Ende für volle Höhe)', fullHeight: 'Volle Höhe',
    save: 'Artikel speichern', saving: 'Wird gespeichert…', savedButton: 'Gespeichert · Aktualisieren', saved: 'Gespeichert. Verwalten und exportieren Sie den Artikel unter Gespeicherte Artikel herunterladen.', savedUnresolved: 'Seiteninformationen gespeichert; Zuordnung noch unbestätigt.', saveFailed: 'Speichern fehlgeschlagen. Bitte erneut versuchen.', collection: 'Gespeicherte Artikel herunterladen', collectionOpening: 'Gespeicherte Artikel werden geöffnet…', collectionOpened: 'Gespeicherte Artikel geöffnet.', collectionFailed: 'Gespeicherte Artikel konnten nicht geöffnet werden.', contents: 'Artikelinhalt, scrollbar', retryGenerate: 'Erneut auf {language} erzeugen',
    matched: 'Literatureintrag gefunden.', resolving: 'Öffentliche Literaturdaten werden geprüft…', chooseMatch: 'Passenden Eintrag auswählen', uncertain: 'Zuordnung unsicher. Bitte bestätigen Sie einen Eintrag.',
    abstract: 'Abstract', noAbstract: 'Kein Abstract verfügbar', expandAbstract: 'Originalabstract und Übersetzung auf {language} anzeigen', summary: 'Kernaussagen (auf Grundlage des Abstracts)',
    openOriginal: 'Originalseite öffnen', copy: 'Informationen kopieren', generate: 'Text auf {language} erzeugen', settings: 'Einstellungen',
    generating: 'Text auf {language} wird erzeugt…', generated: 'Text auf {language} erzeugt.', generationFailed: 'Die Texterzeugung ist fehlgeschlagen. Bitte versuchen Sie es später manuell erneut.',
    queryFailed: 'Die Literatursuche ist fehlgeschlagen.', cached: 'Aus dem lokalen Cache geladen.', pinned: 'Karte angeheftet.', unpinned: 'Karte losgelöst.',
    settingsFailed: 'Einstellungen konnten nicht geöffnet werden.', copyUnavailable: 'Der Browser erlaubt keinen Zugriff auf die Zwischenablage. Bitte kopieren Sie den Text manuell.', copied: 'In die Zwischenablage kopiert.',
    copyFailed: 'Kopieren fehlgeschlagen. Bitte prüfen Sie die Browserberechtigungen.', confirming: 'Zuordnung wird bestätigt…', confirmed: 'Zuordnung bestätigt.', confirmFailed: 'Bestätigung fehlgeschlagen.',
    outputChanged: 'Die Ausgabesprache hat sich geändert. Bitte erzeugen Sie den Text erneut.',
    previewFailed: 'Lokale Vorschau nicht lesbar. Angezeigte Angaben bleiben erhalten; öffnen Sie die Karte erneut.', unviewed: 'Nicht angesehen', viewed: 'Angesehen', savedBadge: 'Gespeichert', cachedWarning: 'Der Text wurde erzeugt, das lokale Vorschauarchiv konnte jedoch nicht gespeichert werden.',
    completionQueued: 'Gespeichert. Metadaten und Übersetzung warten auf die Hintergrundverarbeitung.', completionResolving: 'Gespeichert. Metadaten werden im Hintergrund geprüft; Sie können weiter suchen.', completionGenerating: 'Gespeichert. Übersetzung und Kernaussagen werden im Hintergrund erzeugt.', completionReady: 'Gespeichert. Angaben vervollständigt.', completionConfirm: 'Gespeichert. Bestätigen Sie einen passenden Eintrag, um fortzufahren.', completionConfigure: 'Gespeichert. Konfigurieren Sie das Modell und starten Sie die Ergänzung in der Sammlung erneut.', completionFailed: 'Gespeichert, aber die Ergänzung ist fehlgeschlagen. In der Sammlung erneut versuchen.', completionInterrupted: 'Gespeichert. Ergänzung unterbrochen. In der Sammlung erneut versuchen.',
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
