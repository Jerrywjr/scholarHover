import { LANGUAGE_NAMES, type Language } from './languages';
import type { Paper, SavedPaper } from './types';

const labels = {
  'zh-CN': {
    title: '缓存文章', originalTitle: '原标题', translatedTitle: '译文标题', authors: '作者', year: '年份',
    venue: '期刊或会议', summary: '摘要要点（基于摘要）', abstract: '摘要原文', translation: '摘要译文',
    citation: 'APA 风格引用（依据现有元数据，需核对）', citationNote: '作者名称保留来源顺序与写法；缺失的卷期、页码等字段未补造。BibTeX 使用通用 misc 类型，正式引用前请核对出版物类型和格式。',
    sources: '信息来源', paperLink: '原文页面', pdf: '本地原文 PDF', pdfNote: '以下本地链接对应本次尝试下载的 PDF；下载失败时文件可能不存在，请查看原文页面。',
    missing: '未提供', noAbstract: '暂无摘要', notGenerated: '尚未生成', match: '匹配状态',
    matched: '已匹配', confirmed: '用户确认', unresolved: '未确认匹配', model: '模型', language: '译文语言',
    generatedAt: '生成时间', savedAt: '首次缓存时间', updatedAt: '更新时间', fingerprint: '输入指纹',
    preprint: '预印本', version: '下载版本', yes: '是',
  },
  en: {
    title: 'Saved papers', originalTitle: 'Original title', translatedTitle: 'Translated title', authors: 'Authors', year: 'Year',
    venue: 'Journal or conference', summary: 'Key point (based on abstract)', abstract: 'Original abstract', translation: 'Translated abstract',
    citation: 'APA-style citation (from available metadata; verify before citing)', citationNote: 'Author names retain their source order and spelling. Missing volume, issue and page fields are not invented. BibTeX uses the generic misc type; verify publication type and citation formatting before use.',
    sources: 'Data sources', paperLink: 'Original article page', pdf: 'Local full-text PDF', pdfNote: 'The local links correspond to attempted PDF downloads. Files may be absent if a download failed; use the original article page.',
    missing: 'Not provided', noAbstract: 'No abstract available', notGenerated: 'Not generated', match: 'Match status',
    matched: 'Matched', confirmed: 'User confirmed', unresolved: 'Unresolved', model: 'Model', language: 'Translation language',
    generatedAt: 'Generated at', savedAt: 'First saved at', updatedAt: 'Updated at', fingerprint: 'Input fingerprint',
    preprint: 'Preprint', version: 'Download version', yes: 'Yes',
  },
  fr: {
    title: 'Articles enregistrés', originalTitle: 'Titre original', translatedTitle: 'Titre traduit', authors: 'Auteurs', year: 'Année',
    venue: 'Revue ou conférence', summary: 'Point clé (fondé sur le résumé)', abstract: 'Résumé original', translation: 'Résumé traduit',
    citation: 'Référence de style APA (métadonnées disponibles ; à vérifier)', citationNote: 'Les noms des auteurs conservent leur ordre et leur orthographe d’origine. Les volumes, numéros et pages manquants ne sont pas inventés. BibTeX utilise le type générique misc ; vérifiez le type de publication et le format avant de citer.',
    sources: 'Sources des données', paperLink: 'Page de l’article original', pdf: 'PDF local du texte intégral', pdfNote: 'Les liens locaux correspondent aux tentatives de téléchargement des PDF. Un fichier peut manquer en cas d’échec ; consultez la page originale.',
    missing: 'Non fourni', noAbstract: 'Aucun résumé disponible', notGenerated: 'Non généré', match: 'État de correspondance',
    matched: 'Correspondance trouvée', confirmed: 'Confirmé par l’utilisateur', unresolved: 'Non confirmé', model: 'Modèle', language: 'Langue de traduction',
    generatedAt: 'Date de génération', savedAt: 'Premier enregistrement', updatedAt: 'Mise à jour', fingerprint: 'Empreinte des données',
    preprint: 'Prépublication', version: 'Version téléchargée', yes: 'Oui',
  },
  de: {
    title: 'Gespeicherte Artikel', originalTitle: 'Originaltitel', translatedTitle: 'Übersetzter Titel', authors: 'Autoren', year: 'Jahr',
    venue: 'Zeitschrift oder Konferenz', summary: 'Kernaussage (aus dem Abstract)', abstract: 'Originalabstract', translation: 'Übersetzter Abstract',
    citation: 'Zitat im APA-Stil (aus vorhandenen Metadaten; bitte prüfen)', citationNote: 'Autorennamen behalten Reihenfolge und Schreibweise der Quelle. Fehlende Bände, Ausgaben und Seiten werden nicht erfunden. BibTeX verwendet den allgemeinen Typ misc; prüfen Sie Veröffentlichungstyp und Zitierformat vor der Verwendung.',
    sources: 'Datenquellen', paperLink: 'Originalseite des Artikels', pdf: 'Lokale Volltext-PDF', pdfNote: 'Die lokalen Links entsprechen den versuchten PDF-Downloads. Bei einem fehlgeschlagenen Download kann die Datei fehlen; öffnen Sie dann die Originalseite.',
    missing: 'Nicht angegeben', noAbstract: 'Kein Abstract verfügbar', notGenerated: 'Nicht erzeugt', match: 'Zuordnungsstatus',
    matched: 'Zugeordnet', confirmed: 'Vom Nutzer bestätigt', unresolved: 'Nicht bestätigt', model: 'Modell', language: 'Übersetzungssprache',
    generatedAt: 'Erzeugt am', savedAt: 'Zuerst gespeichert am', updatedAt: 'Aktualisiert am', fingerprint: 'Eingabe-Fingerabdruck',
    preprint: 'Preprint', version: 'Download-Version', yes: 'Ja',
  },
} satisfies Record<Language, Record<string, string>>;

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '').replace(/\r\n?/gu, '\n');
}
const singleLine = (value: string): string => cleanText(value).replace(/\s+/gu, ' ').trim();
function markdown(value: string): string {
  return cleanText(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~-]/gu, '\\$&');
}
function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href.replace(/[<>"`\\]/gu, char => encodeURIComponent(char));
  } catch { return undefined; }
}
function link(text: string, url: string): string {
  const target = safeUrl(url);
  return target ? `[${markdown(text)}](<${target}>)` : markdown(singleLine(url));
}
function localFilenameUrl(filename: string): string {
  return encodeURIComponent(filename).replace(/[!'()*]/gu, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function iso(value: number): string {
  return Number.isFinite(value) && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : '';
}

function citation(paper: Paper): string {
  const authors = paper.authors.map(singleLine).filter(Boolean);
  const authorText = authors.length > 1 ? `${authors.slice(0, -1).join(', ')}, & ${authors.at(-1)}` : authors[0];
  const year = paper.year ? String(paper.year) : 'n.d.';
  const title = singleLine(paper.title);
  const venue = paper.venue ? ` ${singleLine(paper.venue)}.` : '';
  const doi = paper.doi ? safeUrl(`https://doi.org/${paper.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '')}`) : undefined;
  const url = doi ?? safeUrl(paper.url);
  return `${authorText ? `${authorText}. (${year}). ${title}.` : `${title}. (${year}).`}${venue}${url ? ` ${url}` : ''}`;
}

function bibValue(value: string): string {
  const replacements: Record<string, string> = {
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '$': '\\$',
    '#': '\\#', '&': '\\&', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
    '<': '\\textless{}', '>': '\\textgreater{}',
  };
  return singleLine(value).replace(/[\\{}%$#&_~^<>]/gu, char => replacements[char]);
}
function bibtex(paper: Paper, number: number): string {
  const fields: Array<[string, string | undefined]> = [
    ['title', paper.title],
    ['author', paper.authors.length ? paper.authors.map(author => `{${bibValue(author)}}`).join(' and ') : undefined],
    ['year', paper.year ? String(paper.year) : undefined],
    ['howpublished', paper.venue], ['doi', paper.doi], ['url', safeUrl(paper.url)],
  ];
  const lines = fields.filter((field): field is [string, string] => !!field[1]).map(([key, value]) =>
    `  ${key} = {${key === 'author' ? value : bibValue(value)}}`);
  return `@misc{paper${number},\n${lines.join(',\n')}\n}`;
}

export function paperFilename(paper: Paper, number: number): string {
  const prefix = `${Number.isSafeInteger(number) && number > 0 ? number : 1}-`;
  let title = singleLine(paper.title).normalize('NFC').replace(/[<>:"/\\|?*]/gu, ' ')
    .replace(/\.{2,}/gu, ' ').replace(/\s+/gu, ' ').replace(/^[. ]+|[. ]+$/gu, '');
  if (!title) title = 'paper';
  // Leave room for the numeric prefix and extension on byte-limited filesystems.
  const budget = 200 - new TextEncoder().encode(`${prefix}.pdf`).byteLength;
  let truncated = '';
  for (const char of title) {
    if (new TextEncoder().encode(truncated + char).byteLength > budget) break;
    truncated += char;
  }
  return `${prefix}${truncated.replace(/[. ]+$/gu, '') || 'paper'}.pdf`;
}

export function buildMarkdown(items: SavedPaper[], language: Language): string {
  const t = labels[language] ?? labels['zh-CN'];
  const sections = [`# ${t.title}`, t.pdfNote, t.citationNote];
  items.forEach((entry, index) => {
    const number = index + 1;
    const { paper, generated } = entry;
    const line = (label: string, value: string) => `- **${label}:** ${markdown(singleLine(value))}`;
    const status = paper.matchStatus === 'matched' ? t.matched : paper.matchStatus === 'confirmed' ? t.confirmed : t.unresolved;
    const lines = [
      `## ${number}. ${markdown(singleLine(paper.title))}`,
      line(t.originalTitle, paper.title),
      line(t.translatedTitle, generated?.titleTranslated || t.notGenerated),
      line(t.authors, paper.authors.length ? paper.authors.join('; ') : t.missing),
      line(t.year, paper.year ? String(paper.year) : t.missing),
      line(t.venue, paper.venue || t.missing),
      line(t.match, status),
      line('DOI', paper.doi || t.missing),
      `- **${t.paperLink}:** ${link(paper.url, paper.url)}`,
      `- **${t.pdf}:** [${markdown(paperFilename(paper, number))}](./${localFilenameUrl(paperFilename(paper, number))})`,
    ];
    if (paper.preprint) lines.push(line(t.preprint, t.yes));
    if (paper.downloadVersion) lines.push(line(t.version, paper.downloadVersion));
    lines.push(
      `### ${t.summary}`, markdown(paper.abstract ? generated?.summary || t.notGenerated : t.noAbstract),
      `### ${t.abstract}`, markdown(paper.abstract || t.noAbstract),
      `### ${t.translation}`, markdown(paper.abstract ? generated?.abstractTranslated || t.notGenerated : t.noAbstract),
      `### ${t.citation}`, markdown(citation(paper)),
      '### BibTeX',
    );
    const bib = bibtex(paper, number);
    const fence = '`'.repeat(Math.max(3, ...Array.from(bib.matchAll(/`+/gu), match => match[0].length + 1)));
    lines.push(`${fence}bibtex\n${bib}\n${fence}`, `### ${t.sources}`);
    const sources = new Map([[paper.sourceUrl, paper.source], ...(paper.sources ?? []).map(source => [source.url, source.name] as [string, string])]);
    for (const [url, name] of sources) lines.push(`- ${link(name, url)}`);
    lines.push(line(t.savedAt, iso(entry.savedAt)), line(t.updatedAt, iso(entry.updatedAt)));
    if (generated) lines.push(
      line(t.language, `${LANGUAGE_NAMES[generated.language]} (${generated.language})`),
      line(t.model, generated.model), line(t.generatedAt, iso(generated.createdAt)), line(t.fingerprint, generated.fingerprint),
    );
    sections.push(lines.join('\n\n'));
  });
  return `${sections.join('\n\n')}\n`;
}
