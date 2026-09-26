import { describe, expect, it } from 'vitest';
import { extractSourcePaper, normalizeSourceUrl } from '../src/shared/source-page';
import type { PaperSeed } from '../src/shared/types';

const seed: PaperSeed = {
  title: 'NetConfArena: An Executable Benchmark for LLM Agents in Closed-Loop Network Configuration',
  authors: ['C Liu', 'X Xie', 'X Chen', 'Y Cui'],
  year: 2026,
  preprint: true,
  url: 'https://arxiv.org/abs/2608.23179',
};
const abstract = 'We introduce NetConfArena, an executable benchmark that evaluates agents through network configuration tasks & verifies their outcomes.';
function arxivHtml(extra = ''): string {
  return `<html><head>
    <meta name="citation_title" content="${seed.title}">
    <meta name="citation_author" content="Chang Liu">
    <meta name="citation_author" content="Xiaohui Xie">
    <meta name="citation_author" content="Xinyi Chen">
    <meta name="citation_author" content="Yong Cui">
    <meta name="citation_date" content="2026/08/24">
    <meta name="citation_arxiv_id" content="2608.23179">
    <meta name="citation_pdf_url" content="https://arxiv.org/pdf/2608.23179">
    ${extra}</head><body><h1 class="title mathjax"><span class="descriptor">Title:</span>${seed.title}</h1>
    <blockquote class="abstract mathjax"><span class="descriptor">Abstract:</span>
      We introduce <b>NetConfArena</b>, an executable benchmark that evaluates agents through network configuration tasks &amp; verifies their outcomes.
    </blockquote></body></html>`;
}
const publisherSeed: PaperSeed = {
  title: 'Reliable Network Configuration with Explicit Verification',
  authors: ['J Smith'], year: 2024, preprint: false,
  url: 'https://journal.example/article/42', doi: '10.5555/reliable.42',
};
function publisherHtml(extra: string): string {
  return `<meta name="citation_title" content="${publisherSeed.title}">
    <meta name="citation_author" content="Jane Smith">
    <meta name="citation_publication_date" content="2024-03-12">
    <meta name="citation_doi" content="10.5555/reliable.42">${extra}`;
}

describe('normalizeSourceUrl', () => {
  it.each([
    ['http://arxiv.org/abs/2608.23179', 'https://arxiv.org/abs/2608.23179'],
    ['http://export.arxiv.org/pdf/2608.23179v1', 'https://arxiv.org/abs/2608.23179v1'],
    ['https://arxiv.org/abs/2608.23179', 'https://arxiv.org/abs/2608.23179'],
    ['https://www.arxiv.org/pdf/2608.23179v2.pdf?download=1#page=3', 'https://arxiv.org/abs/2608.23179v2'],
    ['https://export.arxiv.org/html/2401.01234v3', 'https://arxiv.org/abs/2401.01234v3'],
    ['https://arxiv.org/pdf/hep-th/9901001v2', 'https://arxiv.org/abs/hep-th/9901001v2'],
    ['https://arxiv.org/abs/math.GT/0309136', 'https://arxiv.org/abs/math.GT/0309136'],
    ['https://doi.org/10.48550/arXiv.2608.23179', 'https://arxiv.org/abs/2608.23179'],
    ['https://www.nature.com/articles/nature14539.pdf#page=2', 'https://www.nature.com/articles/nature14539'],
    ['https://www.nature.com/articles/s41586-024-01234-5.pdf?download=1', 'https://www.nature.com/articles/s41586-024-01234-5?download=1'],
    ['https://journal.example/articles/nature14539.pdf', 'https://journal.example/articles/nature14539.pdf'],
    ['https://journal.example/article?id=42&lang=en', 'https://journal.example/article?id=42&lang=en'],
  ])('normalizes %s while preserving paper identity', (input, expected) => {
    expect(normalizeSourceUrl(input)).toBe(expected);
  });
  it.each([
    'javascript:alert(1)', 'file:///etc/passwd', 'http://journal.example/article/42',
    'https://user:password@journal.example/article/42', 'https://localhost/paper',
    'https://library.local/paper', 'https://192.168.0.1/paper', 'https://127.1/paper',
    'https://2130706433/paper', 'https://10.0.0.1/paper', 'https://169.254.169.254/latest/meta-data',
    'https://[::1]/paper', 'https://[fc00::1]/paper', 'https://[::ffff:127.0.0.1]/paper',
    'https://scholar.google.com/scholar?cluster=42', 'https://scholar.google.co.uk/citations',
    'https://api.openai.com/v1/models', 'https://api.openalex.org/works/W42',
    'https://journal.example/api/private', 'https://journal.example/account/settings',
    'https://journal.example/login?next=/article/42', 'https://journal.example/article?access_token=secret',
    'https://arxiv.org/search/?query=42', 'https://arxiv.org/abs/2613.12345',
    'https://arxiv.org/abs/2608.23179v0', 'https://arxiv.org/abs/2608.23179/other',
  ])('rejects an unsafe or unsupported source destination %s', input => {
    expect(normalizeSourceUrl(input)).toBeUndefined();
  });
});

describe('extractSourcePaper', () => {
  it('resolves a direct arXiv PDF label to the paper metadata at the same normalized URL', () => {
    const link: PaperSeed = { title: 'PDF', authors: [], url: 'https://arxiv.org/pdf/2608.23179v2.pdf', linkOnly: true };
    expect(extractSourcePaper(arxivHtml().replaceAll('2608.23179', '2608.23179v2'), 'https://arxiv.org/abs/2608.23179v2', link))
      .toMatchObject({ title: seed.title, abstract, downloadVersion: 'submittedVersion (v2)' });
  });
  it('resolves shortened publisher link text only for the exact linked URL', () => {
    const link: PaperSeed = { title: 'Read this paper', authors: [], url: publisherSeed.url, linkOnly: true };
    const html = publisherHtml('<meta name="citation_abstract" content="Verified paper abstract.">');
    expect(extractSourcePaper(html, link.url, link)).toMatchObject({ title: publisherSeed.title, abstract: 'Verified paper abstract.' });
    expect(extractSourcePaper(html, 'https://journal.example/article/another', link)).toBeUndefined();
    expect(extractSourcePaper(html, link.url, { ...link, linkOnly: undefined })).toBeUndefined();
  });
  it('accepts a unique ScholarlyArticle but rejects ambiguous identities and citation title conflicts', () => {
    const link: PaperSeed = { title: 'Read more', authors: [], url: publisherSeed.url, linkOnly: true };
    const article = { '@type': 'ScholarlyArticle', headline: publisherSeed.title, abstract: 'Explicit abstract.' };
    const json = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
    expect(extractSourcePaper(json(article), link.url, link)?.title).toBe(publisherSeed.title);
    expect(extractSourcePaper(json([article, { ...article, headline: 'Another paper' }]), link.url, link)).toBeUndefined();
    expect(extractSourcePaper(publisherHtml(json({ ...article, headline: 'Another paper' })), link.url, link)).toBeUndefined();
    expect(extractSourcePaper('<meta name="dc.title" content="Just a website"><meta property="og:description" content="Teaser">', link.url, link)).toBeUndefined();
  });
  it.each([
    { authors: ['Bob Jones'] }, { year: 2025 }, { doi: '10.5555/another' },
  ])('retains supplied publisher corroboration checks for direct links: %s', extra => {
    const link: PaperSeed = { title: 'PDF', authors: [], url: publisherSeed.url, linkOnly: true, ...extra };
    expect(extractSourcePaper(publisherHtml(''), link.url, link)).toBeUndefined();
  });
  it('reads only the Nature Abstract content and records its location as provenance', () => {
    const link: PaperSeed = { title: 'Deep learning…', authors: [], url: 'https://www.nature.com/articles/nature14539.pdf', linkOnly: true };
    const html = `<meta name="citation_title" content="Deep learning"><meta name="citation_journal_title" content="Nature">
      <section aria-labelledby="Abs1"><h2 id="Abs1">Abstract</h2><div id="Abs1-content"><p>Models learn representations.</p><p>We evaluate multiple layers.</p></div></section>
      <section><h2>Access options</h2><p>Subscribe to read the article.</p></section><meta property="og:description" content="Teaser">`;
    expect(extractSourcePaper(html, 'https://www.nature.com/articles/nature14539', link)).toMatchObject({
      title: 'Deep learning', abstract: 'Models learn representations. We evaluate multiple layers.',
      sources: expect.arrayContaining([{ name: 'Original page · Abstract', url: 'https://www.nature.com/articles/nature14539#Abs1' }]),
    });
    expect(extractSourcePaper(html.replace('id="Abs1-content"', 'class="c-article-section__content"'), 'https://www.nature.com/articles/nature14539', link)?.abstract)
      .toBe('Models learn representations. We evaluate multiple layers.');
    expect(extractSourcePaper(html.replace('<h2 id="Abs1">Abstract</h2>', '<h2 id="Abs1">Summary</h2>'), 'https://www.nature.com/articles/nature14539', link)?.abstract).toBeUndefined();
    expect(extractSourcePaper(html.replaceAll('citation_title', 'og:title'), 'https://www.nature.com/articles/nature14539', link)).toBeUndefined();
  });
  it('accepts arXiv citation_author in the actual surname-comma-given-name format', () => {
    const html = arxivHtml().replace('Chang Liu', 'Liu, Chang').replace('Xiaohui Xie', 'Xie, Xiaohui').replace('Xinyi Chen', 'Chen, Xinyi').replace('Yong Cui', 'Cui, Yong');
    expect(extractSourcePaper(html, seed.url, seed)).toMatchObject({ abstract, authors: ['Chang Liu', 'Xiaohui Xie', 'Xinyi Chen', 'Yong Cui'] });
  });
  it('extracts the screenshot paper from the arXiv abstract block without its label or markup', () => {
    expect(extractSourcePaper(arxivHtml(), seed.url, seed)).toMatchObject({
      title: seed.title, abstract, authors: ['Chang Liu', 'Xiaohui Xie', 'Xinyi Chen', 'Yong Cui'],
      year: 2026, preprint: true, doi: '10.48550/arxiv.2608.23179',
      source: 'Original page', sourceUrl: seed.url, url: seed.url,
      downloadUrl: 'https://arxiv.org/pdf/2608.23179', downloadVersion: 'submittedVersion', matchStatus: 'matched',
    });
  });
  it('uses the h1 title and DC.description fallback when citation_title and blockquote are absent', () => {
    const html = `<h1 class="title"><span class="descriptor">Title:</span>${seed.title}</h1>
      <meta name="DC.description" content="Abstract: A &amp; B propose an executable benchmark for closed-loop configuration.">`;
    expect(extractSourcePaper(html, seed.url, seed)?.abstract).toBe('A & B propose an executable benchmark for closed-loop configuration.');
  });
  it('keeps explicit source versions and derives a matching download version', () => {
    const versioned = { ...seed, url: 'https://arxiv.org/pdf/2608.23179v2.pdf' };
    const html = arxivHtml().replaceAll('2608.23179', '2608.23179v2');
    expect(extractSourcePaper(html, 'https://arxiv.org/abs/2608.23179v2', versioned)).toMatchObject({
      url: 'https://arxiv.org/abs/2608.23179v2', downloadUrl: 'https://arxiv.org/pdf/2608.23179v2',
      downloadVersion: 'submittedVersion (v2)', doi: '10.48550/arxiv.2608.23179',
    });
  });
  it('preserves legacy identifiers without inventing modern arXiv DOIs', () => {
    const oldSeed = { ...seed, url: 'https://arxiv.org/abs/hep-th/9901001v2', year: 1999 };
    const html = `<meta name="citation_title" content="${seed.title}"><blockquote class="abstract">${abstract}</blockquote>`;
    const paper = extractSourcePaper(html, oldSeed.url, oldSeed);
    expect(paper?.downloadUrl).toBe('https://arxiv.org/pdf/hep-th/9901001v2');
    expect(paper?.doi).toBeUndefined();
  });
  it.each([
    ['title mismatch', arxivHtml().replaceAll(seed.title, 'An unrelated executable benchmark'), seed.url, seed],
    ['arXiv redirect', arxivHtml(), 'https://arxiv.org/abs/2608.22222', seed],
    ['metadata id mismatch', arxivHtml().replace('content="2608.23179"', 'content="2608.22222"'), seed.url, seed],
    ['arXiv DOI mismatch', arxivHtml('<meta name="citation_doi" content="10.48550/arXiv.2608.22222">'), seed.url, seed],
    ['explicit version mismatch', arxivHtml().replaceAll('2608.23179', '2608.23179v3'), 'https://arxiv.org/abs/2608.23179v3', { ...seed, url: 'https://arxiv.org/abs/2608.23179v2' }],
    ['DOI mismatch', arxivHtml(), seed.url, { ...seed, doi: '10.5555/published' }],
    ['published seed', arxivHtml(), seed.url, { ...seed, preprint: false }],
    ['author mismatch', arxivHtml().replaceAll('Chang Liu', 'Bob Liu').replaceAll('Xiaohui Xie', 'Bob Xie').replaceAll('Xinyi Chen', 'Bob Chen').replaceAll('Yong Cui', 'Bob Cui'), seed.url, seed],
  ])('rejects %s instead of silently substituting papers', (_reason, html, url, input) => {
    expect(extractSourcePaper(html, url, input)).toBeUndefined();
  });
  it('does not mistake a published DOI cited by an arXiv page for the source version DOI', () => {
    expect(extractSourcePaper(arxivHtml('<meta name="citation_doi" content="10.5555/published">'), seed.url, seed)?.doi)
      .toBe('10.48550/arxiv.2608.23179');
  });
  it('can retain a matching source with no abstract for later supplementation', () => {
    const paper = extractSourcePaper(`<meta name="citation_title" content="${seed.title}">`, seed.url, seed);
    expect(paper?.matchStatus).toBe('matched');
    expect(paper?.abstract).toBeUndefined();
  });
  it.each([
    '<title>Login</title><form><input type="password"></form>',
    '<title>Verify you are human</title><div class="g-recaptcha">CAPTCHA</div>',
    '<title>Unrelated page</title><p>A vague page description.</p>',
    `<title>Access denied</title>${arxivHtml()}`,
  ])('rejects unrelated, login, and challenge pages', html => {
    expect(extractSourcePaper(html, seed.url, seed)).toBeUndefined();
  });
  it('reads citation abstracts as text and retains a safe publisher PDF', () => {
    const paper = extractSourcePaper(publisherHtml(`<meta name="citation_abstract" content="&lt;p&gt;We verify A &amp;amp; B configurations.&lt;/p&gt;">
      <meta name="citation_pdf_url" content="/download/42.pdf">`), publisherSeed.url, publisherSeed);
    expect(paper).toMatchObject({ abstract: 'We verify A & B configurations.', downloadUrl: 'https://journal.example/download/42.pdf',
      sourceUrl: publisherSeed.url, doi: '10.5555/reliable.42', authors: ['Jane Smith'], year: 2024, preprint: false });
  });
  it('never treats generic descriptions or Scholar snippets as a full abstract', () => {
    const paper = extractSourcePaper(publisherHtml(`<meta property="og:description" content="Summary of this article">
      <meta name="description" content="A search snippet"><meta name="DC.description" content="A publisher landing-page description">
      <p class="gs_rs">Scholar excerpt</p>`), publisherSeed.url, publisherSeed);
    expect(paper?.matchStatus).toBe('matched');
    expect(paper?.abstract).toBeUndefined();
  });
  it('rejects a second conflicting DOI in matching structured article metadata', () => {
    const html = publisherHtml(`<meta name="citation_abstract" content="Verified explicit abstract text.">
      <script type="application/ld+json">${JSON.stringify({ '@type': 'ScholarlyArticle', headline: publisherSeed.title,
        identifier: '10.5555/different.version', abstract: 'An abstract for a conflicting identity.' })}</script>`);
    expect(extractSourcePaper(html, publisherSeed.url, publisherSeed)).toBeUndefined();
  });
  it('does not attach a preprint PDF to a known published paper', () => {
    const paper = extractSourcePaper(publisherHtml('<meta name="citation_pdf_url" content="https://arxiv.org/pdf/2608.23179">'),
      publisherSeed.url, publisherSeed);
    expect(paper?.matchStatus).toBe('matched');
    expect(paper?.downloadUrl).toBeUndefined();
  });
  it('accepts an arXiv DOI with an explicit version only when that version was fetched', () => {
    const versioned = { ...seed, url: 'https://arxiv.org/abs/2608.23179v2', doi: '10.48550/arxiv.2608.23179v2' };
    const html = arxivHtml().replaceAll('2608.23179', '2608.23179v2');
    expect(extractSourcePaper(html, versioned.url, versioned)?.downloadUrl).toBe('https://arxiv.org/pdf/2608.23179v2');
    expect(extractSourcePaper(arxivHtml(), seed.url, { ...seed, doi: versioned.doi })).toBeUndefined();
  });
  it('rejects generic DOI conflicts even when titles match', () => {
    expect(extractSourcePaper(publisherHtml('<meta name="citation_abstract" content="Verified explicit abstract text.">')
      .replace('10.5555/reliable.42', '10.5555/another'), publisherSeed.url, publisherSeed)).toBeUndefined();
  });
  it('requires author and year corroboration when a generic page has no matching DOI', () => {
    const noDoi = { ...publisherSeed, doi: undefined };
    const page = publisherHtml('<meta name="citation_abstract" content="Verified explicit abstract text.">');
    expect(extractSourcePaper(page, noDoi.url, noDoi)?.abstract).toBe('Verified explicit abstract text.');
    expect(extractSourcePaper(page.replace('Jane Smith', 'Bob Smith'), noDoi.url, noDoi)).toBeUndefined();
    expect(extractSourcePaper(page.replace('2024-03-12', '2025-03-12'), noDoi.url, noDoi)).toBeUndefined();
  });
  it('drops unsafe PDF links and never executes source scripts', () => {
    const html = publisherHtml(`<meta name="citation_abstract" content="Verified explicit abstract text.">
      <meta name="citation_pdf_url" content="https://localhost/private.pdf"><script>throw new Error("must not run")</script>`);
    const paper = extractSourcePaper(html, publisherSeed.url, publisherSeed);
    expect(paper?.abstract).toBe('Verified explicit abstract text.');
    expect(paper?.downloadUrl).toBeUndefined();
  });
  it('reads only a matching ScholarlyArticle with an explicit JSON-LD abstract', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebSite', description: 'This must not become an abstract.' },
      { '@type': 'ScholarlyArticle', headline: publisherSeed.title, abstract: '<p>We verify network changes &amp; measure failures.</p>',
        author: [{ '@type': 'Person', name: 'Jane Smith' }], datePublished: '2024-03-12', identifier: 'https://doi.org/10.5555/reliable.42' },
    ] })}</script>`;
    expect(extractSourcePaper(html, publisherSeed.url, publisherSeed)).toMatchObject({
      title: publisherSeed.title, abstract: 'We verify network changes & measure failures.', authors: ['Jane Smith'], year: 2024,
    });
    expect(extractSourcePaper(html.replace('"abstract":', '"description":'), publisherSeed.url, publisherSeed)?.abstract).toBeUndefined();
  });
  it('ignores malformed JSON-LD and rejects oversized documents without throwing', () => {
    expect(extractSourcePaper('<script type="application/ld+json">{bad json}</script>', publisherSeed.url, publisherSeed)).toBeUndefined();
    expect(extractSourcePaper(arxivHtml() + ' '.repeat(2_100_000), seed.url, seed)).toBeUndefined();
  });
});
