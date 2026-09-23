import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Isolated packaged-extension regression. Metadata fetch alone is replaced;
// permissions, message routing, offscreen DOMParser, storage, UI and the model
// worker are real. The model endpoint is a disposable loopback HTTPS server.
const root = fileURLToPath(new URL('..', import.meta.url));
const extension = path.join(root, 'dist');
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
assert.ok(manifest.host_permissions.includes('https://arxiv.org/*'), 'Build the source-reading extension before running this regression');
const title = 'NetConfArena: An Executable Benchmark for LLM Agents in Closed-Loop Network Configuration';
const abstract = 'We introduce NetConfArena, an executable benchmark for LLM agents in closed-loop network configuration. The environment evaluates configuration changes and observes actual network outcomes. This is an artificial regression fixture, not the paper’s published abstract. ABSTRACT_FIXTURE_END';
const translated = 'NetConfArena 的离线测试摘要译文。TRANSLATION_FIXTURE_END';
const summary = '该离线夹具用于验证原文摘要获取、后台生成和本地缓存。';
const profile = await mkdtemp(path.join(tmpdir(), 'scholar-hover-source-e2e-'));
let context;
let modelServer;
let worker;
let modelRequests = 0;
const errors = [];
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const waitUntil = async (predicate, message, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 75));
  }
};
const seedFor = version => ({ title, authors: ['C Liu', 'X Xie', 'X Chen', 'Y Cui'], year: 2026,
  venue: 'arXiv preprint', url: `https://arxiv.org/pdf/2608.23179v${version}`, preprint: true });
const scholarHtml = (url, preprint = true) => `<!doctype html><html><meta charset="utf-8"><title>Offline Scholar source regression</title>
  <style>body{font:16px/1.5 system-ui;margin:60px}.gs_r{max-width:650px}.gs_rt a{font-size:19px}.gs_a{color:#567}</style>
  <main><div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="${url}">${title}</a></h3>
  <div class="gs_a">C Liu, X Xie, X Chen, Y Cui - ${preprint ? 'arXiv preprint' : 'Journal Example'}, 2026 - ${preprint ? 'arxiv.org' : 'journal.example'}</div>
  <div class="gs_rs">A truncated search snippet that MUST NOT become the abstract.</div></div></main></html>`;

async function installFetchBoundary(target) {
  await target.evaluate(({ title, abstract }) => {
    globalThis.__sourceRequests = [];
    globalThis.__failedVersions = [];
    globalThis.__heldVersion = '';
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      globalThis.__sourceRequests.push({ host: url.hostname, path: url.pathname, credentials: init.credentials,
        redirect: init.redirect, authorization: new Headers(init.headers).has('authorization') });
      if (url.hostname === 'api.openalex.org' || url.hostname === 'api.crossref.org') {
        return new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } });
      }
      if (url.hostname !== 'arxiv.org' || !/^\/abs\/2608\.23179v\d+$/.test(url.pathname)) {
        throw new Error('Regression fixture blocked an unexpected external request');
      }
      const version = url.pathname.match(/v\d+$/)[0];
      if (version === globalThis.__heldVersion) await new Promise(resolve => { globalThis.__releaseSource = resolve; });
      if (globalThis.__failedVersions.includes(version)) return new Response('temporarily unavailable', { status: 503, headers: { 'content-type': 'text/html' } });
      return new Response(`<!doctype html><html><head><meta name="citation_title" content="${title}">
        <meta name="citation_author" content="Liu, Chang"><meta name="citation_author" content="Xie, Xiaohui">
        <meta name="citation_author" content="Chen, Xinyi"><meta name="citation_author" content="Cui, Yong">
        <meta name="citation_date" content="2026/08/24"><meta name="citation_arxiv_id" content="2608.23179${version}">
        <meta name="citation_pdf_url" content="https://arxiv.org/pdf/2608.23179${version}"></head><body>
        <h1 class="title"><span class="descriptor">Title:</span>${title}</h1>
        <blockquote class="abstract"><span class="descriptor">Abstract:</span>${abstract}</blockquote>
        <script>globalThis.__SOURCE_SCRIPT_EXECUTED = true;</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
  }, { title, abstract });
}

async function openScholar(versionOrUrl, query, beforeHover) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const url = typeof versionOrUrl === 'number' ? seedFor(versionOrUrl).url : versionOrUrl;
  await page.route('https://scholar.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: scholarHtml(url, typeof versionOrUrl === 'number') }));
  await page.goto(`https://scholar.google.com/scholar?q=${query}`);
  const card = page.locator('#scholar-hover-card');
  await card.waitFor({ state: 'attached' });
  if (beforeHover) await beforeHover(page);
  await page.getByRole('link', { name: title, exact: true }).hover();
  await card.waitFor({ state: 'visible' });
  return { page, card };
}

async function completeAbstract(card) {
  await card.locator('details p').first().waitFor({ state: 'attached' });
  assert.equal(await card.locator('details p').first().textContent(), abstract, 'Original abstract must be complete, not the Scholar snippet');
}

async function requests() { return worker.evaluate(() => globalThis.__sourceRequests); }
async function sourceCount() { return (await requests()).filter(request => request.host === 'arxiv.org').length; }
async function indexCount() { return (await requests()).filter(request => request.host === 'api.openalex.org' || request.host === 'api.crossref.org').length; }
async function collection() { return worker.evaluate(async () => (await chrome.storage.local.get('savedCollection')).savedCollection); }

try {
  const certificate = path.join(profile, 'fixture-cert.pem');
  const key = path.join(profile, 'fixture-key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate,
    '-subj', '/CN=api.openalex.org', '-days', '1', '-addext', 'subjectAltName=DNS:api.openalex.org'], { stdio: 'ignore' });
  modelServer = createServer({ key: await readFile(key), cert: await readFile(certificate) }, (request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      modelRequests++;
      const prompt = JSON.parse(body);
      if (!JSON.stringify(prompt).includes('ABSTRACT_FIXTURE_END')) errors.push('The model did not receive the complete source abstract');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ titleTranslated: 'NetConfArena 原文读取回归夹具',
        abstractTranslated: translated, summary }) } }] }));
    });
  });
  await new Promise((resolve, reject) => { modelServer.once('error', reject); modelServer.listen(0, '127.0.0.1', resolve); });
  const modelOrigin = `https://api.openalex.org:${modelServer.address().port}`;
  const launchOptions = { channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP api.openalex.org 127.0.0.1', '--ignore-certificate-errors'] };
  context = await chromium.launchPersistentContext(profile, launchOptions);
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(worker.url()).hostname;
  await installFetchBoundary(worker);
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ settings: { uiLanguage: 'en', outputLanguage: 'zh-CN', autoGenerate: false,
      consent: false, rememberKey: false, baseUrl: '', model: '' } });
  });
  check('Native manifest permission grants arXiv access', await worker.evaluate(() => chrome.permissions.contains({ origins: ['https://arxiv.org/*'] })));
  check('Unapproved publisher permission is genuinely absent', !await worker.evaluate(() => chrome.permissions.contains({ origins: ['https://journal.example/*'] })));
  check('MV3 service worker has no DOMParser', await worker.evaluate(() => typeof DOMParser === 'undefined'));

  const first = await openScholar(1, 'source-first');
  await completeAbstract(first.card);
  check('Direct source shows verified title without a candidate confirmation', await first.card.getByRole('heading').textContent() === title && await first.card.locator('[data-action="confirm"]').count() === 0);
  check('Original page provenance points to the exact arXiv version', await first.card.locator('a[href="https://arxiv.org/abs/2608.23179v1"]').count() > 0);
  check('Complete source abstract avoids all index requests', await sourceCount() === 1 && await indexCount() === 0);
  check('Real offscreen document performs source parsing', await worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length === 1));
  await first.page.close();
  const reopened = await openScholar(1, 'source-reopened');
  await completeAbstract(reopened.card);
  check('Reopened source preview uses persisted metadata without refetching', await sourceCount() === 1 && await indexCount() === 0);
  await reopened.page.close();

  // Reproduce an archive produced before direct source reading existed.
  await worker.evaluate(async seed => {
    const key = JSON.stringify(['preview-v1', seed.title.toLowerCase(), seed.authors.map(name => name.toLowerCase()), seed.year,
      seed.url, '', true]);
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('scholar-hover-archive', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('previews', 'readwrite');
      tx.objectStore('previews').put({ key, value: { paper: { ...seed, id: 'old-429-fixture', source: 'Google Scholar',
        sourceUrl: seed.url, matchStatus: 'unresolved' }, candidates: [], warning: 'OpenAlex 查询失败：HTTP 429' } });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, seedFor(2));
  const old = await openScholar(2, 'old-429-archive', async page => {
    await page.locator('.gs_r[data-scholar-hover-state="viewed"]').waitFor();
    check('Scholar recognizes the old archived seed before any source refresh', await sourceCount() === 1);
  });
  await completeAbstract(old.card);
  check('Old unresolved 429 archive automatically refreshes through the source URL', await sourceCount() === 2 && await indexCount() === 0);
  check('Successful source refresh removes the stale 429 warning', !(await old.card.locator('section').textContent()).includes('429'));
  await old.page.close();

  await worker.evaluate(() => { globalThis.__failedVersions = ['v3']; });
  const failed = await openScholar(3, 'failed-source');
  await failed.card.locator('.warning').filter({ hasText: '503' }).waitFor();
  check('Source HTTP failure exposes an explicit metadata retry', await failed.card.locator('[data-action="retry-metadata"]').isEnabled());
  check('Failed explicit arXiv version is never replaced through indexes', await indexCount() === 0);
  await worker.evaluate(() => { globalThis.__failedVersions = []; });
  await failed.card.locator('[data-action="retry-metadata"]').click();
  await completeAbstract(failed.card);
  check('Explicit retry recovers the exact failed source version', await sourceCount() === 4);
  await failed.page.close();

  const unapproved = await openScholar('https://journal.example/article/42', 'unapproved-publisher');
  await unapproved.card.locator('[data-action="source-access"]').waitFor();
  await unapproved.card.locator('.warning').filter({ hasText: '429' }).waitFor();
  check('Missing source permission is actionable while index failure remains visible', await unapproved.card.locator('[data-action="retry-metadata"]').isEnabled());
  check('Unapproved publisher was never fetched', !(await requests()).some(request => request.host === 'journal.example'));
  await unapproved.page.close();

  // Configure an artificial session key through the real trusted settings RPC.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const configured = await options.evaluate(async modelOrigin => chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: {
    uiLanguage: 'en', outputLanguage: 'zh-CN', baseUrl: `${modelOrigin}/v1`, model: 'source-regression-fixture',
    autoGenerate: false, consent: true, rememberKey: false }, apiKey: 'OFFLINE_FIXTURE_NOT_A_REAL_KEY' }), modelOrigin);
  check('Real settings permission check accepts only the fixture model origin', configured.ok === true);
  await options.close();
  await worker.evaluate(() => { globalThis.__heldVersion = 'v4'; });
  const slow = await openScholar(4, 'save-during-source-read');
  await waitUntil(() => worker.evaluate(() => typeof globalThis.__releaseSource === 'function'), 'Source request must remain held while saving');
  const saveStart = Date.now();
  await slow.card.locator('[data-action="save"]').click();
  await slow.card.locator('[data-action="save"]').filter({ hasText: /Saved|cached/i }).waitFor({ timeout: 2500 });
  const earlySaveMs = Date.now() - saveStart;
  const pending = (await collection()).items.find(item => item.seed?.url === seedFor(4).url);
  check('Immediate save persists before source fetch completes', earlySaveMs < 2500 && pending && ['queued', 'resolving'].includes(pending.completion.status));
  await slow.page.close();
  await worker.evaluate(() => { globalThis.__heldVersion = ''; globalThis.__releaseSource(); delete globalThis.__releaseSource; });
  await waitUntil(async () => (await collection()).items.some(item => item.seed?.url === seedFor(4).url && item.completion?.status === 'ready'),
    'Background source, translation and summary should finish after closing Scholar');
  const completed = (await collection()).items.find(item => item.seed?.url === seedFor(4).url);
  check('Background completion retains full original abstract and generated output', completed.paper.abstract === abstract
    && completed.generated.abstractTranslated === translated && completed.generated.summary === summary);
  check('Background job invokes the fixture model exactly once', modelRequests === 1);
  check('Early-save and hover requests share one source lookup', await sourceCount() === 5);
  const savedRevisit = await openScholar(4, 'saved-revisit');
  await completeAbstract(savedRevisit.card);
  await savedRevisit.card.getByText('NetConfArena 原文读取回归夹具', { exact: true }).waitFor();
  check('Saved revisit does not repeat source or model calls', await sourceCount() === 5 && modelRequests === 1);
  await savedRevisit.page.close();
  const initialRequests = await requests();
  check('Source fetch omits cookies and authorization and rejects redirects', initialRequests.filter(request => request.host === 'arxiv.org')
    .every(request => request.credentials === 'omit' && request.redirect === 'error' && !request.authorization));
  check('Only the intentional unapproved publisher case called an index', initialRequests.filter(request => request.host === 'api.openalex.org').length === 1
    && initialRequests.filter(request => request.host === 'api.crossref.org').length === 0);

  // A real browser restart rules out content-script memory, worker Maps, and
  // session storage as explanations for persistence.
  await context.close();
  context = await chromium.launchPersistentContext(profile, launchOptions);
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
  await installFetchBoundary(worker);
  check('Restart keeps the same extension storage identity', new URL(worker.url()).hostname === extensionId);
  check('Restart clears the artificial session credential', await worker.evaluate(async () => !(await chrome.storage.session.get('apiKey')).apiKey));
  const restarted = await openScholar(4, 'browser-restarted');
  await completeAbstract(restarted.card);
  await restarted.card.getByText('NetConfArena 原文读取回归夹具', { exact: true }).waitFor();
  check('IndexedDB and saved collection restore complete output after restart', await sourceCount() === 0 && await indexCount() === 0 && modelRequests === 1);
  await restarted.page.close();
  const unsavedRestart = await openScholar(1, 'unsaved-browser-restarted');
  await completeAbstract(unsavedRestart.card);
  check('Unsaved source preview also survives a real browser restart', await sourceCount() === 0 && await indexCount() === 0 && modelRequests === 1);
  check('No page errors or incomplete-model-input errors occurred', errors.length === 0);
  console.log(JSON.stringify({ checks: checks.length, sourceRequests: initialRequests.filter(request => request.host === 'arxiv.org').length,
    openAlexRequests: initialRequests.filter(request => request.host === 'api.openalex.org').length,
    crossrefRequests: initialRequests.filter(request => request.host === 'api.crossref.org').length,
    modelRequests, postRestartRequests: (await requests()).length, earlySaveMs, errors: errors.length }));
} catch (error) {
  const card = context?.pages().find(page => page.url().startsWith('https://scholar.google.com/'));
  if (card) error.message += `; card=${await card.locator('#scholar-hover-card').locator('section').textContent().catch(() => '')}`;
  throw error;
} finally {
  await context?.close();
  if (modelServer?.listening) await new Promise(resolve => modelServer.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
