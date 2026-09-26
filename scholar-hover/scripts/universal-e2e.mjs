import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { prepareBrowserFixture } from './browser-fixture.mjs';

// The only fixture manifest change pre-grants optional HTTPS access because a
// headless browser cannot answer Chrome's native permission dialog. All code,
// dynamic script registration, popup routing, DOM parsing, IDB and model worker
// are production. Public sites and the paid model are replaced with fixtures.
const profile = await mkdtemp(path.join(tmpdir(), 'scholar-hover-universal-'));
const extension = await prepareBrowserFixture(profile);
const checks = [];
const errors = [];
let context, worker, modelServer;
let modelRequests = 0;
const check = (label, value) => { assert.ok(value, label); checks.push(label); };
const waitUntil = async (predicate, label, timeout = 15_000) => {
  const end = Date.now() + timeout;
  while (!await predicate()) { assert.ok(Date.now() < end, label); await new Promise(resolve => setTimeout(resolve, 75)); }
};
const abstract = 'In 120 samples, no significant increase was observed. This is a synthetic regression fixture. ABSTRACT_END';
const arxivTitle = 'Direct source evidence from a linked preprint';
const natureTitle = 'Evidence and uncertainty in a publisher article';
const pageHtml = `<!doctype html><html><meta charset="utf-8"><title>Offline journal links</title>
  <style>body{font:18px/2 system-ui;padding:50px}a{display:block;max-width:600px}</style><h1>References</h1>
  <a id="arxiv" href="https://arxiv.org/pdf/2608.23179v1">PDF</a>
  <a id="alias" href="https://arxiv.org/abs/2608.23179v1">A different link label for this preprint</a>
  <a id="nature" href="https://www.nature.com/articles/nature14539.pdf">Publisher article…</a>
  <a id="slow" href="https://arxiv.org/abs/2608.23179v2">Save this one now</a>
  <a id="late" href="https://arxiv.org/abs/2608.23179v3">Turn off before this one returns</a>
  <a id="ordinary" href="https://reading.example/about">About this reading group</a></html>`;
const track = page => { page.on('pageerror', error => errors.push(error.message)); return page; };
async function openFixture(url = 'https://www.nature.com/reading-list') {
  const page = track(await context.newPage());
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: pageHtml }));
  await page.goto(url);
  return page;
}
async function installSourceFixture() {
  await worker.evaluate(({ arxivTitle, natureTitle, abstract }) => {
    globalThis.__requests = [];
    globalThis.__held = '';
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      globalThis.__requests.push({ url: url.href, authorization: new Headers(init?.headers).has('authorization'), credentials: init?.credentials });
      if (url.hostname.startsWith('api.')) return new Response('{}', { status: 429 });
      if (url.pathname.endsWith(globalThis.__held) && globalThis.__held) await new Promise(resolve => { globalThis.__release = resolve; });
      let html = '<title>About our reading group</title><meta name="description" content="This webpage description must never become a paper abstract.">';
      if (url.hostname === 'arxiv.org') html = `<meta name="citation_title" content="${arxivTitle}">
        <meta name="citation_author" content="Smith, Alice"><meta name="citation_date" content="2026/08/20">
        <meta name="citation_arxiv_id" content="${url.pathname.split('/').at(-1)}"><blockquote class="abstract"><span class="descriptor">Abstract:</span>${abstract}</blockquote>`;
      if (url.hostname === 'www.nature.com') html = `<meta name="citation_title" content="${natureTitle}">
        <meta name="citation_author" content="Alice Smith"><meta name="citation_date" content="2026/08/20">
        <meta name="citation_doi" content="10.1038/nature14539"><meta name="citation_journal_title" content="Nature">
        <meta name="citation_pdf_url" content="/articles/nature14539.pdf">
        <meta name="description" content="This description must not become the abstract."><section aria-labelledby="Abs1">
        <h2 id="Abs1">Abstract</h2><div id="Abs1-content"><p>${abstract}</p></div></section><section><h2>Access options</h2><p>Subscribe</p></section>`;
      const response = new Response(html, { headers: { 'content-type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    };
  }, { arxivTitle, natureTitle, abstract });
}
const requests = () => worker.evaluate(() => globalThis.__requests);
const count = async () => (await requests()).length;
const collection = () => worker.evaluate(async () => (await chrome.storage.local.get('savedCollection')).savedCollection);
async function hover(page, selector) {
  await page.locator(selector).hover();
  const card = page.locator('#scholar-hover-card');
  await card.waitFor({ state: 'visible' });
  return card;
}
async function closeCard(page) {
  await page.keyboard.press('Escape');
  await page.mouse.move(1, 1);
}
async function popupFor(id) {
  const popup = track(await context.newPage());
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#hover-toggle').waitFor();
  await waitUntil(() => popup.locator('#hover-toggle').isEnabled(), 'Popup must load switch state');
  return popup;
}
try {
  const cert = path.join(profile, 'fixture.pem'), key = path.join(profile, 'fixture-key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-subj', '/CN=api.openalex.org', '-days', '1', '-addext', 'subjectAltName=DNS:api.openalex.org'], { stdio: 'ignore' });
  modelServer = createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    let raw = ''; request.setEncoding('utf8'); request.on('data', data => { raw += data; });
    request.on('end', () => {
      modelRequests++;
      const hasAbstract = JSON.stringify(JSON.parse(raw)).includes('ABSTRACT_END');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ titleTranslated: '已读取链接中的论文标题',
        abstractTranslated: hasAbstract ? '在 120 个样本中未观察到显著增加。ABSTRACT_END' : null,
        summary: hasAbstract ? '该测试样本中未观察到显著增加。' : null }) } }] }));
    });
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  const modelUrl = `https://api.openalex.org:${modelServer.address().port}/v1`;
  const launch = { channel: 'chromium', headless: true, viewport: { width: 1360, height: 950 }, ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP api.openalex.org 127.0.0.1', '--ignore-certificate-errors'] };
  context = await chromium.launchPersistentContext(profile, launch);
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  await installSourceFixture();
  const settings = track(await context.newPage()); await settings.goto(`chrome-extension://${id}/options.html`);
  check('Model configured through trusted settings with an artificial key', (await settings.evaluate(baseUrl => chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: {
    uiLanguage: 'en', outputLanguage: 'zh-CN', baseUrl, model: 'offline-universal', consent: true, autoGenerate: true, rememberKey: false }, apiKey: 'OFFLINE_NOT_A_REAL_KEY' }), modelUrl)).ok);
  await settings.close();
  const nature = await openFixture();
  await nature.locator('#arxiv').hover(); await nature.waitForTimeout(600);
  check('New install is off: no content injection or requests', await nature.locator('#scholar-hover-card').count() === 0 && await count() === 0);
  let popup = await popupFor(id);
  check('Toolbar exposes an OFF switch', await popup.locator('#hover-toggle').getAttribute('aria-checked') === 'false');
  await popup.locator('#hover-toggle').click();
  await waitUntil(async () => await popup.locator('#hover-toggle').getAttribute('aria-checked') === 'true', 'Enable popup');
  check('Dynamic content script registered for HTTPS top-level pages', await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).some(script => script.matches.includes('https://*/*') && !script.allFrames)));
  check('Existing Nature page injected without refresh', await nature.locator('#scholar-hover-card').count() === 1);
  await popup.close();
  await nature.locator('#arxiv').hover(); await nature.mouse.move(1, 1); await nature.waitForTimeout(600);
  check('Rapid passing hover does not fetch or call the model', await count() === 0 && modelRequests === 0);
  let card = await hover(nature, '#arxiv');
  await card.getByRole('heading', { name: arxivTitle, exact: true }).waitFor();
  await card.getByText('已读取链接中的论文标题', { exact: true }).waitFor();
  check('PDF link label replaced by verified arXiv title and full abstract', await card.locator('details p').first().textContent() === abstract);
  check('Generic hover does not call an index or repeat model generation', await count() === 1 && modelRequests === 1);
  await closeCard(nature);
  card = await hover(nature, '#alias'); await card.getByText('已读取链接中的论文标题', { exact: true }).waitFor();
  check('Different labels for one exact arXiv revision reuse cached translation', await count() === 1 && modelRequests === 1);
  await closeCard(nature);
  card = await hover(nature, '#nature');
  await card.getByRole('heading', { name: natureTitle, exact: true }).waitFor();
  await card.getByText('已读取链接中的论文标题', { exact: true }).waitFor();
  check('Nature PDF links read a marked Abstract section, excluding description and paywall text', await card.locator('details p').first().textContent() === abstract);
  check('Nature abstract provenance remains directly linked', await card.locator('a[href="https://www.nature.com/articles/nature14539#Abs1"]').count() === 1);
  await closeCard(nature);
  await worker.evaluate(() => { globalThis.__held = 'v2'; });
  card = await hover(nature, '#slow');
  await waitUntil(() => worker.evaluate(() => typeof globalThis.__release === 'function'), 'Held source request');
  const saveStart = Date.now(); await card.locator('[data-action="save"]').click();
  await waitUntil(async () => (await collection())?.items?.length === 1, 'Immediate save');
  const saveMs = Date.now() - saveStart;
  check('Save acknowledged while source retrieval remains pending', saveMs < 2500 && ['queued', 'resolving'].includes((await collection()).items[0].completion.status));
  await nature.close();
  await worker.evaluate(() => { globalThis.__held = ''; globalThis.__release(); delete globalThis.__release; });
  await waitUntil(async () => (await collection()).items[0].completion?.status === 'ready', 'Background completion after closing page');
  check('Background completion stores translated source after originating tab closes', (await collection()).items[0].generated.abstractTranslated.includes('120'));
  const arxiv = await openFixture('https://arxiv.org/list/cs/recent');
  card = await hover(arxiv, '#slow'); await card.getByText('已读取链接中的论文标题', { exact: true }).waitFor();
  check('Saved paper reopens across websites without new source/model calls', await count() === 3 && modelRequests === 3);
  await closeCard(arxiv);
  await worker.evaluate(() => { globalThis.__held = 'v3'; });
  await hover(arxiv, '#late');
  await waitUntil(() => worker.evaluate(() => typeof globalThis.__release === 'function'), 'Held late request');
  popup = await popupFor(id); await popup.locator('#hover-toggle').click();
  await waitUntil(async () => await popup.locator('#hover-toggle').getAttribute('aria-checked') === 'false', 'Disable popup');
  await arxiv.locator('#scholar-hover-card').waitFor({ state: 'detached' });
  await worker.evaluate(() => { globalThis.__held = ''; globalThis.__release(); delete globalThis.__release; });
  await arxiv.waitForTimeout(700);
  check('Turning off removes the panel and suppresses generation from a late source result', await arxiv.locator('#scholar-hover-card').count() === 0 && modelRequests === 3);
  check('Turning off unregisters future injection and keeps saved papers', (await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length === 0 && (await collection()).items.length === 1);
  await popup.locator('#hover-toggle').click();
  await waitUntil(async () => await popup.locator('#hover-toggle').getAttribute('aria-checked') === 'true', 'Re-enable popup');
  await popup.close();
  await arxiv.evaluate(() => { const a = document.createElement('a'); a.id='dynamic'; a.href='https://arxiv.org/pdf/2608.23179v1'; a.textContent='Dynamically added reference'; document.body.append(a); });
  await arxiv.locator('#dynamic').focus();
  card = arxiv.locator('#scholar-hover-card'); await card.getByText('已读取链接中的论文标题', { exact: true }).waitFor();
  check('Keyboard focus and newly inserted links work after live re-enable', await arxiv.locator('#scholar-hover-card').count() === 1 && await count() === 4 && modelRequests === 3);
  await closeCard(arxiv);
  card = await hover(arxiv, '#ordinary');
  await card.locator('.warning').waitFor();
  check('Ordinary link does not invent a paper abstract or auto-spend tokens', await card.locator('details p').count() === 0 && modelRequests === 3);
  await card.locator('[data-action="generate"]').click();
  await card.getByText('已读取链接中的论文标题', { exact: true }).waitFor();
  check('Manual ordinary-link translation is title-only', modelRequests === 4 && await card.locator('details p').count() === 0);
  const allRequests = await requests();
  check('Only hovered destinations are fetched, with no source credentials or index lookup', allRequests.length === 5 && allRequests.every(request => !new URL(request.url).hostname.startsWith('api.') && !request.authorization && request.credentials === 'omit'));
  await mkdir('test-results', { recursive: true });
  popup = await popupFor(id); await popup.screenshot({ path: 'test-results/universal-popup.png' });
  await popup.locator('#hover-toggle').click();
  await waitUntil(async () => await popup.locator('#hover-toggle').getAttribute('aria-checked') === 'false', 'Disable before restart');
  await context.close();
  context = await chromium.launchPersistentContext(profile, launch);
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  popup = await popupFor(id);
  check('OFF persists across real browser restart', await popup.locator('#hover-toggle').getAttribute('aria-checked') === 'false');
  await popup.locator('#hover-toggle').click();
  await waitUntil(async () => await popup.locator('#hover-toggle').getAttribute('aria-checked') === 'true', 'Enable after restart');
  await installSourceFixture();
  const restarted = await openFixture('https://reading.example/after-restart');
  card = await hover(restarted, '#alias'); await card.getByText('已读取链接中的论文标题', { exact: true }).waitFor();
  check('Unsaved cross-site translation survives restart without credentials or network', await count() === 0 && modelRequests === 4);
  check('No page errors', errors.length === 0);
  console.log(JSON.stringify({ checks: checks.length, sourceRequests: allRequests.length, modelRequests, earlySaveMs: saveMs, errors, nativePermissionDialog: 'not automated; fixture pre-grants HTTPS' }));
} catch (error) {
  for (const page of context?.pages() ?? []) {
    const card = page.locator('#scholar-hover-card');
    if (await card.count().catch(() => 0)) console.error(JSON.stringify({ page: page.url(), card: await card.locator('section').textContent().catch(() => ''), modelRequests }));
  }
  throw error;
} finally {
  await context?.close();
  if (modelServer?.listening) await new Promise(resolve => modelServer.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
