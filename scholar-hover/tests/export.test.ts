import { describe, expect, it } from 'vitest';
import { buildMarkdown, paperFilename } from '../src/shared/export';
import type { Paper, SavedPaper } from '../src/shared/types';

const paper = (patch: Partial<Paper> = {}): Paper => ({
  id: 'oa:one', title: 'A useful study', authors: ['Alice Chen', 'Bob Smith'], year: 2025,
  venue: 'Example Journal', abstract: 'The abstract contains 42 participants and no significant effect.',
  doi: '10.1234/example', url: 'https://example.org/article', source: 'OpenAlex',
  sourceUrl: 'https://openalex.org/W1', matchStatus: 'matched', ...patch,
});
const saved = (patch: Partial<Paper> = {}): SavedPaper => ({
  id: 'oa:one', paper: paper(patch), savedAt: 0, updatedAt: 1,
  generated: { titleTranslated: '一项研究', abstractTranslated: '42 名参与者，没有显著效果。',
    summary: '此摘要未发现显著效果。', language: 'zh-CN', model: 'example-model', fingerprint: 'fp', createdAt: 1 },
});

describe('research collection Markdown export', () => {
  it('exports current order with matching numbered local PDF links, complete metadata and provenance', () => {
    const second = { ...saved({ title: 'Second study' }), id: 'second' };
    const md = buildMarkdown([second, saved()], 'en');
    expect(md.indexOf('## 1. Second study')).toBeLessThan(md.indexOf('## 2. A useful study'));
    for (const text of ['Alice Chen', 'Bob Smith', 'Example Journal', '42 participants', '42 名参与者',
      '此摘要未发现显著效果', '一项研究', 'APA', 'BibTeX', 'example\\-model', 'zh\\-CN',
      '1970', '10.1234/example', '@misc{paper1', 'doi = {10.1234/example}']) expect(md).toContain(text);
    expect(md).toContain(`./${encodeURIComponent(paperFilename(second.paper, 1))}`);
    expect(md).toContain('may be absent');
    expect(md).toContain('metadata');
    expect(md).not.toMatch(/(?:volume|number|pages) =/);
  });

  it('labels missing original abstract, translation, summary and uncertain match without fabricating them', () => {
    const entry: SavedPaper = { id: 'one', paper: paper({ abstract: undefined, authors: [], year: undefined, venue: undefined, doi: undefined, matchStatus: 'unresolved' }), savedAt: 0, updatedAt: 0 };
    const md = buildMarkdown([entry], 'en');
    expect(md).toContain('No abstract available');
    expect(md).toContain('Not generated');
    expect(md).toContain('Unresolved');
    expect(md).toContain('\\(n\\.d\\.\\)');
    expect(md).not.toMatch(/(?:author|year|doi|howpublished) =/);
  });

  it.each([
    ['zh-CN', '缓存文章', '摘要原文'], ['en', 'Saved papers', 'Original abstract'],
    ['fr', 'Articles enregistrés', 'Résumé original'], ['de', 'Gespeicherte Artikel', 'Originalabstract'],
  ] as const)('uses %s export headings without changing stored translation language', (language, heading, abstract) => {
    const md = buildMarkdown([saved()], language);
    expect(md).toContain(heading);
    expect(md).toContain(abstract);
    expect(md).toContain('一项研究');
  });

  it('escapes Markdown/HTML and invalid links while keeping BibTeX inside its code fence', () => {
    const entry = saved({ title: 'Danger\n# Heading [click](javascript:alert(1)) <script>x</script> ```',
      authors: ['Name }\n@article{attack, title={Injected}'], abstract: '<img src=x onerror=alert(1)>\n# Injected',
      url: 'javascript:alert(1)', sourceUrl: 'https://example.org/x?x=<script>&y=1' });
    const md = buildMarkdown([entry], 'en');
    expect(md).not.toContain('<script>');
    expect(md).not.toContain('<img');
    expect(md).not.toContain('\n# Heading');
    const outsideCodeFence = md.replace(/````bibtex\n[\s\S]*?\n````/u, '');
    expect(outsideCodeFence).not.toContain('](javascript:');
    expect(md).toContain('\\# Heading');
    expect(md).toContain('\\} @article\\{attack');
    expect(md).toContain('````bibtex');
  });

  it('percent-encodes parentheses and quotes in relative PDF links', () => {
    const md = buildMarkdown([saved({ title: "Paper (revisited)'s result" })], 'en');
    expect(md).toContain('./1-Paper%20%28revisited%29%27s%20result.pdf');
  });
});

describe('numbered paper filenames', () => {
  it('preserves Unicode but removes path separators, controls and reserved characters', () => {
    const filename = paperFilename(paper({ title: '../研究 / test\\name: *?<>|\u0000\u202e.pdf.' }), 3);
    expect(filename).toMatch(/^3-/);
    expect(filename).toMatch(/\.pdf$/);
    expect(filename).toContain('研究');
    expect(filename).not.toMatch(/[\\/:*?<>|\u0000\u202e]/);
    expect(filename).not.toContain('..');
  });

  it('has a portable byte bound even for long Unicode and always has a non-empty basename', () => {
    expect(new TextEncoder().encode(paperFilename(paper({ title: '论'.repeat(1_000) }), 200)).length).toBeLessThanOrEqual(200);
    expect(paperFilename(paper({ title: '\u0000/\\:.' }), 1)).toBe('1-paper.pdf');
  });
});
