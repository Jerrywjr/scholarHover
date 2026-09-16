import type { Language } from './languages';

// Existing worker diagnostics are stable internal keys. Provider response text is
// never interpolated; unknown exceptions become a localized generic message.
const messages = [
  ['文件已下载，但服务器未标明 PDF 类型，请检查下载目录或原文页面。', 'The file was downloaded, but its server did not identify it as PDF. Check the download folder or source page.', 'Le fichier a été téléchargé, mais le serveur ne l’identifie pas comme PDF. Vérifiez le dossier de téléchargement ou la page originale.', 'Die Datei wurde heruntergeladen, aber vom Server nicht als PDF ausgewiesen. Prüfen Sie den Downloadordner oder die Originalseite.'],
  ['请在缓存文章管理页执行此操作。', 'Use the saved papers manager for this action.', 'Effectuez cette action dans le gestionnaire des articles enregistrés.', 'Führen Sie diese Aktion in der Verwaltung gespeicherter Artikel aus.'],
  ['缓存文章数据无效。', 'Invalid saved-paper data.', 'Données d’article enregistré invalides.', 'Ungültige Daten des gespeicherten Artikels.'],
  ['缓存列表已更新，请刷新后重试。', 'The collection changed. Refresh and try again.', 'La collection a changé. Actualisez et réessayez.', 'Die Sammlung wurde geändert. Aktualisieren Sie sie und versuchen Sie es erneut.'],
  ['缓存文章已达 200 篇上限，请先删除部分文章。', 'The collection limit is 200 papers. Remove some papers first.', 'La limite est de 200 articles. Supprimez d’abord quelques articles.', 'Die Sammlung ist auf 200 Artikel begrenzt. Entfernen Sie zuerst einige Artikel.'],
  ['缓存文章超过 4 MiB 容量，请先删除部分文章。', 'The collection exceeds 4 MiB. Remove some papers first.', 'La collection dépasse 4 MiB. Supprimez d’abord quelques articles.', 'Die Sammlung überschreitet 4 MiB. Entfernen Sie zuerst einige Artikel.'],
  ['缓存文章不存在，请刷新后重试。', 'The saved paper is no longer available. Refresh and try again.', 'L’article enregistré n’est plus disponible. Actualisez et réessayez.', 'Der gespeicherte Artikel ist nicht mehr verfügbar. Aktualisieren Sie die Liste.'],
  ['文章排序无效，请刷新后重试。', 'Invalid paper order. Refresh and try again.', 'Ordre des articles invalide. Actualisez et réessayez.', 'Ungültige Artikelreihenfolge. Aktualisieren Sie die Liste.'],
  ['未找到可直接下载的原文 PDF，请在原文页面获取。', 'No direct PDF is available. Obtain the full text from the source page.', 'Aucun PDF direct disponible. Consultez la page originale pour obtenir le texte intégral.', 'Kein direkter PDF-Link verfügbar. Rufen Sie den Volltext auf der Originalseite ab.'],
  ['原文下载未能开始，请打开原文页面后重试。', 'The download could not start. Open the source page and try again.', 'Le téléchargement n’a pas démarré. Ouvrez la page originale et réessayez.', 'Der Download konnte nicht starten. Öffnen Sie die Originalseite und versuchen Sie es erneut.'],
  ['下载状态已中断，请手动重试。', 'The download state was interrupted. Retry manually.', 'L’état du téléchargement a été interrompu. Réessayez manuellement.', 'Der Downloadstatus wurde unterbrochen. Versuchen Sie es manuell erneut.'],
  ['下载记录已不可用，请手动重试。', 'The download record is unavailable. Retry manually.', 'La trace du téléchargement est indisponible. Réessayez manuellement.', 'Der Downloadeintrag ist nicht verfügbar. Versuchen Sie es manuell erneut.'],
  ['下载已取消，可手动重试。', 'Download cancelled. You can retry manually.', 'Téléchargement annulé. Vous pouvez réessayer manuellement.', 'Download abgebrochen. Sie können es manuell erneut versuchen.'],
  ['下载中断，请检查网络或在原文页面完成登录认证后重试。', 'Download interrupted. Check the network or sign in on the source page, then retry.', 'Téléchargement interrompu. Vérifiez le réseau ou connectez-vous sur la page originale, puis réessayez.', 'Download unterbrochen. Prüfen Sie das Netzwerk oder melden Sie sich auf der Originalseite an und versuchen Sie es erneut.'],
  ['下载返回了非 PDF 内容，可能需要登录认证，请打开原文页面。', 'The response was not a PDF. Open the source page; sign-in may be required.', 'La réponse n’est pas un PDF. Ouvrez la page originale ; une connexion peut être nécessaire.', 'Die Antwort war keine PDF-Datei. Öffnen Sie die Originalseite; möglicherweise ist eine Anmeldung erforderlich.'],
  ['下载返回非 PDF 内容，且无法清理该文件，请手动检查下载目录。', 'The response was not a PDF and could not be removed. Check the downloads folder.', 'La réponse n’est pas un PDF et n’a pas pu être supprimée. Vérifiez le dossier de téléchargement.', 'Die Antwort war keine PDF-Datei und konnte nicht entfernt werden. Prüfen Sie den Downloadordner.'],
  ['已有下载任务进行中，请完成后再导出。', 'An export is in progress. Wait for it to finish before exporting again.', 'Un export est en cours. Attendez sa fin avant de relancer.', 'Ein Export läuft bereits. Warten Sie vor einem weiteren Export auf dessen Abschluss.'],
  ['请先缓存至少一篇文章。', 'Save at least one paper first.', 'Enregistrez d’abord au moins un article.', 'Speichern Sie zuerst mindestens einen Artikel.'],
  ['Markdown 下载未能开始，请重新导出。', 'Markdown download could not start. Export again.', 'Le téléchargement Markdown n’a pas démarré. Relancez l’export.', 'Der Markdown-Download konnte nicht starten. Exportieren Sie erneut.'],
  ['下载任务已变化，请刷新后重试。', 'The export job changed. Refresh and try again.', 'La tâche d’export a changé. Actualisez et réessayez.', 'Der Exportauftrag wurde geändert. Aktualisieren Sie die Seite.'],
  ['仅可重试失败的下载。', 'Only failed downloads can be retried.', 'Seuls les téléchargements échoués peuvent être relancés.', 'Nur fehlgeschlagene Downloads können erneut gestartet werden.'],
  ['操作失败，请重试。', 'Operation failed. Please try again.', 'Échec de l’opération. Veuillez réessayer.', 'Vorgang fehlgeschlagen. Bitte erneut versuchen.'],
  ['API 地址必须为不含参数的 HTTPS 地址', 'Use an HTTPS API URL without credentials, query parameters or a fragment.', 'Utilisez une URL API HTTPS sans identifiants, paramètres ni fragment.', 'Verwenden Sie eine HTTPS-API-Adresse ohne Zugangsdaten, Abfrageparameter oder Fragment.'],
  ['请先填写 HTTPS API 地址', 'Enter an HTTPS API URL first.', 'Saisissez d’abord une URL API HTTPS.', 'Geben Sie zuerst eine HTTPS-API-Adresse ein.'],
  ['请先填写模型名称', 'Enter a model name first.', 'Saisissez d’abord le nom du modèle.', 'Geben Sie zuerst einen Modellnamen ein.'],
  ['请先填写 API Key', 'Enter an API key first.', 'Saisissez d’abord une clé API.', 'Geben Sie zuerst einen API-Schlüssel ein.'],
  ['请先确认将文献内容发送给模型服务', 'First agree to send the paper text to the model service.', 'Acceptez d’abord l’envoi du texte de l’article au service de modèle.', 'Stimmen Sie zuerst der Übermittlung des Artikeltextes an den Modelldienst zu.'],
  ['题目不能为空', 'The title cannot be empty.', 'Le titre ne peut pas être vide.', 'Der Titel darf nicht leer sein.'],
  ['题目过长，无法安全生成完整中文题目', 'The title is too long for a complete translation.', 'Le titre est trop long pour une traduction complète.', 'Der Titel ist für eine vollständige Übersetzung zu lang.'],
  ['摘要过长，无法安全生成完整中文摘要', 'The abstract is too long for a complete translation.', 'Le résumé est trop long pour une traduction complète.', 'Der Abstract ist für eine vollständige Übersetzung zu lang.'],
  ['模型返回格式无效', 'The model returned an invalid response format.', 'Le format de la réponse du modèle est invalide.', 'Das Antwortformat des Modells ist ungültig.'],
  ['模型返回内容过长', 'The model response is too large.', 'La réponse du modèle est trop volumineuse.', 'Die Modellantwort ist zu groß.'],
  ['API Key 无效或未获授权', 'The API key is invalid or unauthorized.', 'La clé API est invalide ou non autorisée.', 'Der API-Schlüssel ist ungültig oder nicht autorisiert.'],
  ['请求过于频繁，请稍后重试', 'Rate limit reached. Please try again later.', 'Limite de requêtes atteinte. Réessayez plus tard.', 'Anfragelimit erreicht. Bitte später erneut versuchen.'],
  ['模型服务请求失败', 'The model service request failed.', 'La requête au service de modèle a échoué.', 'Die Anfrage an den Modelldienst ist fehlgeschlagen.'],
  ['请求超时，请稍后重试', 'The request timed out. Please try again later.', 'Le délai de la requête a été dépassé. Réessayez plus tard.', 'Die Zeit für die Anfrage ist abgelaufen. Bitte später erneut versuchen.'],
  ['模型在 90 秒内未开始返回结果，请手动重试或检查模型服务。', 'The model did not start responding within 90 seconds. Retry manually or check the model service.', 'Le modèle n’a pas commencé à répondre dans les 90 secondes. Réessayez manuellement ou vérifiez le service du modèle.', 'Das Modell hat nicht innerhalb von 90 Sekunden geantwortet. Versuchen Sie es manuell erneut oder prüfen Sie den Modelldienst.'],
  ['模型已响应，但 90 秒内未返回完整结果，请手动重试。', 'The model responded but did not finish within 90 seconds. Retry manually.', 'Le modèle a répondu, mais n’a pas terminé dans les 90 secondes. Réessayez manuellement.', 'Das Modell hat geantwortet, aber nicht innerhalb von 90 Sekunden abgeschlossen. Versuchen Sie es manuell erneut.'],
  ['无法连接模型服务，请检查地址和网络', 'Cannot connect to the model service. Check the URL and network.', 'Connexion au service de modèle impossible. Vérifiez l’URL et le réseau.', 'Keine Verbindung zum Modelldienst. Prüfen Sie Adresse und Netzwerk.'],
  ['论文信息格式不正确，请刷新搜索结果。', 'Invalid paper information. Refresh the search results.', 'Informations d’article invalides. Actualisez les résultats.', 'Ungültige Artikeldaten. Aktualisieren Sie die Suchergebnisse.'],
  ['论文链接无效。', 'The paper link is invalid.', 'Le lien de l’article est invalide.', 'Der Artikellink ist ungültig.'],
  ['论文年份无效。', 'The publication year is invalid.', 'L’année de publication est invalide.', 'Das Erscheinungsjahr ist ungültig.'],
  ['论文标识无效。', 'The paper identifier is invalid.', 'L’identifiant de l’article est invalide.', 'Die Artikelkennung ist ungültig.'],
  ['请先在当前标签页打开论文卡片并确认匹配。', 'Open the paper card in this tab and confirm its match first.', 'Ouvrez d’abord la fiche dans cet onglet et confirmez la correspondance.', 'Öffnen Sie zuerst die Artikelkarte in diesem Tab und bestätigen Sie die Zuordnung.'],
  ['请先在设置中同意发送论文文本。', 'First agree to send paper text in Settings.', 'Acceptez d’abord l’envoi du texte dans les paramètres.', 'Stimmen Sie zuerst in den Einstellungen der Textübermittlung zu.'],
  ['请先配置模型服务。', 'Configure a model service in Settings first.', 'Configurez d’abord un service de modèle dans les paramètres.', 'Konfigurieren Sie zuerst einen Modelldienst in den Einstellungen.'],
  ['模型网站访问权限未授予，请在设置中重新保存。', 'Model host access is not granted. Save the settings again to grant access.', 'L’accès au domaine du modèle n’est pas autorisé. Enregistrez à nouveau les paramètres.', 'Der Zugriff auf die Modelldomain ist nicht erlaubt. Speichern Sie die Einstellungen erneut.'],
  ['请先填写模型 API Key；会话密钥在浏览器重启后需要重新填写。', 'Enter a model API key. Session keys must be re-entered after restarting the browser.', 'Saisissez une clé API. Les clés de session doivent être saisies après chaque redémarrage du navigateur.', 'Geben Sie einen Modell-API-Schlüssel ein. Sitzungsschlüssel müssen nach einem Browserneustart erneut eingegeben werden.'],
  ['请求来源无效。', 'Invalid request origin.', 'Origine de la requête invalide.', 'Ungültige Anfrageherkunft.'],
  ['此页面不支持文献助手。', 'The assistant is not supported on this page.', 'L’assistant n’est pas disponible sur cette page.', 'Der Assistent wird auf dieser Seite nicht unterstützt.'],
  ['请在扩展设置页执行此操作。', 'Perform this action in the extension settings.', 'Effectuez cette action dans les paramètres de l’extension.', 'Führen Sie diese Aktion in den Erweiterungseinstellungen aus.'],
  ['配置格式无效。', 'Invalid settings format.', 'Format des paramètres invalide.', 'Ungültiges Einstellungsformat.'],
  ['请先授予模型域名访问权限。', 'Grant access to the model domain first.', 'Autorisez d’abord l’accès au domaine du modèle.', 'Erlauben Sie zuerst den Zugriff auf die Modelldomain.'],
  ['密钥格式无效。', 'Invalid key format.', 'Format de clé invalide.', 'Ungültiges Schlüsselformat.'],
  ['请在 Scholar 搜索结果页预览论文。', 'Preview papers on a Scholar search results page.', 'Prévisualisez les articles sur une page de résultats Scholar.', 'Zeigen Sie Artikel auf einer Scholar-Suchergebnisseite an.'],
  ['候选已失效，请重新打开卡片。', 'This candidate has expired. Reopen the card.', 'Cette proposition a expiré. Rouvrez la fiche.', 'Dieser Vorschlag ist abgelaufen. Öffnen Sie die Karte erneut.'],
  ['不支持的扩展请求。', 'Unsupported extension request.', 'Requête d’extension non prise en charge.', 'Nicht unterstützte Erweiterungsanfrage.'],
  ['扩展未响应，请刷新页面后重试。', 'The extension did not respond. Refresh the page and try again.', 'L’extension ne répond pas. Actualisez la page et réessayez.', 'Die Erweiterung antwortet nicht. Laden Sie die Seite neu und versuchen Sie es erneut.'],
  ['扩展存储初始化失败，请重新加载扩展。', 'Extension storage could not be initialized. Reload the extension.', 'Impossible d’initialiser le stockage. Rechargez l’extension.', 'Der Erweiterungsspeicher konnte nicht initialisiert werden. Laden Sie die Erweiterung neu.'],
  ['响应内容过大', 'The response is too large.', 'La réponse est trop volumineuse.', 'Die Antwort ist zu groß.'],
  ['响应正文不可读取', 'The response body cannot be read.', 'Le corps de la réponse est illisible.', 'Der Antwortinhalt kann nicht gelesen werden.'],
  ['请求超时', 'Request timed out.', 'Délai de requête dépassé.', 'Zeitüberschreitung der Anfrage.'],
  ['未知网络错误', 'Network or response error.', 'Erreur réseau ou de réponse.', 'Netzwerk- oder Antwortfehler.'],
  ['DOI 查询返回了冲突或不完整的记录。', 'The DOI lookup returned a conflicting or incomplete record.', 'La recherche DOI a renvoyé une notice contradictoire ou incomplète.', 'Die DOI-Abfrage lieferte einen widersprüchlichen oder unvollständigen Datensatz.'],
  ['DOI 查询返回了格式异常的记录。', 'The DOI lookup returned a malformed record.', 'La recherche DOI a renvoyé une notice mal formée.', 'Die DOI-Abfrage lieferte einen fehlerhaften Datensatz.'],
  ['存在多个或无法验证的候选记录，需要人工确认。', 'Multiple or unverified candidates require your confirmation.', 'Plusieurs notices ou des notices non vérifiées nécessitent votre confirmation.', 'Mehrere oder ungeprüfte Vorschläge müssen von Ihnen bestätigt werden.'],
  ['未找到可验证的 OpenAlex 匹配记录。', 'No verifiable OpenAlex match was found.', 'Aucune correspondance OpenAlex vérifiable n’a été trouvée.', 'Keine überprüfbare OpenAlex-Zuordnung gefunden.'],
  ['Crossref · 摘要', 'Crossref · Abstract', 'Crossref · Résumé', 'Crossref · Abstract'],
] as const;
const languageIndex: Record<Language, number> = { 'zh-CN': 0, en: 1, fr: 2, de: 3 };
const byMessage = new Map<string, readonly string[]>(messages.map(row => [row[0], row]));

export function localizeError(message: string, language: Language): string {
  const index = languageIndex[language] ?? 0;
  const known = byMessage.get(message);
  if (known) return known[index]
    .replace('完整中文题目', '完整题目译文')
    .replace('完整中文摘要', '完整摘要译文');
  const matchedPrefix = 'OpenAlex 已匹配，但';
  if (message.startsWith(matchedPrefix)) {
    const prefix = ['OpenAlex 已匹配，但', 'OpenAlex matched, but ', 'Correspondance OpenAlex trouvée, mais ', 'OpenAlex-Zuordnung gefunden, aber '][index];
    return prefix + localizeError(message.slice(matchedPrefix.length), language);
  }
  const metadataPrefix = '元数据查询失败：';
  if (message.startsWith(metadataPrefix)) {
    const prefix = ['元数据查询失败：', 'Metadata lookup failed: ', 'Échec de la recherche de métadonnées : ', 'Metadatenabfrage fehlgeschlagen: '][index];
    const detail = message.slice(metadataPrefix.length);
    const safeDetail = /^HTTP [1-5]\d\d$/.test(detail) ? detail
      : (byMessage.get(detail) ?? byMessage.get('未知网络错误')!)[index];
    return prefix + safeDetail;
  }
  return byMessage.get('操作失败，请重试。')![index];
}
