import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { prepareBrowserFixture, enableHoverFixture } from './browser-fixture.mjs';

const results = path.resolve('test-results');
await mkdir(results, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'scholar-hover-e2e-'));
const downloads = path.join(profile, 'downloads');
await mkdir(downloads);
await mkdir(path.join(profile, 'Default'));
await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
  download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
}));
const certificatePath = path.join(profile, 'model-cert.pem');
const privateKeyPath = path.join(profile, 'model-key.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKeyPath, '-out', certificatePath,
  '-subj', '/CN=api.openalex.org', '-days', '1', '-addext', 'subjectAltName=DNS:api.openalex.org'], { stdio: 'ignore' });
const modelRequests = [];
const slowModelDelayMs = Number(process.env.SCHOLAR_HOVER_SLOW_MODEL_MS ?? 31_000);
let modelFixture = { hold: false, fail: false, delayMs: 0 };
const heldModelRequests = [];
const modelResponse = body => {
  const prompt = JSON.stringify(body);
  const language = prompt.includes('Write all translated output in French') ? 'fr' : prompt.includes('Write all translated output in German') ? 'de' : prompt.includes('Write all translated output in English') ? 'en' : 'zh-CN';
  const text = {
    'zh-CN': { titleTranslated: '测量中的证据与不确定性', abstractTranslated: '在 120 个样本中，未观察到显著增加。', summary: '该研究在 120 个样本中未发现显著增加。' },
    en: { titleTranslated: 'Evidence and uncertainty in measurement', abstractTranslated: 'In 120 samples, no significant increase was observed.', summary: 'The study found no significant increase in 120 samples.' },
    fr: { titleTranslated: 'Preuves et incertitude dans la mesure', abstractTranslated: 'Dans 120 échantillons, aucune augmentation significative n’a été observée.', summary: 'L’étude n’a constaté aucune augmentation significative dans 120 échantillons.' },
    de: { titleTranslated: 'Belege und Unsicherheit bei der Messung', abstractTranslated: 'Bei 120 Stichproben wurde kein signifikanter Anstieg beobachtet.', summary: 'Die Studie fand bei 120 Stichproben keinen signifikanten Anstieg.' },
  };
  const output = prompt.includes('Long abstract measurement study')
    ? { titleTranslated: 'Long abstract translated result', abstractTranslated: 'Across 120 samples, no significant increase was observed; uncertainty remained substantial. '.repeat(55) + 'TRANSLATION_END', summary: 'The study found no significant increase in 120 samples despite substantial uncertainty.' }
    : text[language];
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] });
};
const modelServer = createSecureServer({ key: await readFile(privateKeyPath), cert: await readFile(certificatePath) }, (request, response) => {
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => { void (async () => {
    const body = JSON.parse(raw);
    modelRequests.push({ host: 'api.openalex.org', path: request.url, body });
    const fixture = { ...modelFixture };
    modelFixture.delayMs = 0;
    if (fixture.hold) await new Promise(resolve => heldModelRequests.push(resolve));
    if (fixture.delayMs) await new Promise(resolve => setTimeout(resolve, fixture.delayMs));
    response.writeHead(fixture.fail ? 500 : 200, { 'Content-Type': 'application/json' });
    response.end(fixture.fail ? '{}' : modelResponse(body));
  })().catch(() => { response.writeHead(500); response.end('{}'); }); });
});
await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
modelServer.unref();
const modelOrigin = `https://api.openalex.org:${modelServer.address().port}`;
let authorizedPdf = false;
const fixturePdf = (() => {
  const stream = 'BT /F1 18 Tf 50 740 Td (Offline Scholar Hover PDF fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(document)); document += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
})();
const server = createServer((request, response) => {
  const isPdf = request.url?.startsWith('/pdf/') && (!request.url.includes('auth') || authorizedPdf);
  response.writeHead(200, { 'Content-Type': isPdf ? 'application/pdf' : 'text/html; charset=utf-8' });
  response.end(isPdf ? fixturePdf : '<!doctype html><title>Offline publisher authentication fixture</title><h1>Original article / authentication fixture</h1>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
server.unref();
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
const extension = await prepareBrowserFixture(profile);
const launchOptions = {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
  acceptDownloads: true, downloadsPath: downloads, ignoreHTTPSErrors: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP api.openalex.org 127.0.0.1', '--ignore-certificate-errors'],
};
let context = await chromium.launchPersistentContext(profile, launchOptions);
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const waitUntil = async (predicate, description, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, description);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const workerErrors = [];
  worker.on('close', () => {});
  // Network-only doubles: real packaged content, options, worker, matching, cache and storage execute.
  // Permission grant/denial logic is unit-tested; native permission dialogs remain a manual check.
  const installWorkerFixture = target => target.evaluate(fixtureOrigin => {
    globalThis.__requests = [];
    globalThis.__modelFixture = { hold: false, fail: false };
    globalThis.__metadataFixture = { holdTitle: '' };
    chrome.permissions.contains = async ({ origins }) => origins?.every(origin => origin === 'https://*/*' || origin === 'https://model.test/*' || origin.startsWith('https://api.openalex.org')) ?? false;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      globalThis.__requests.push({ host: url.host, path: url.pathname, body: init.body ? JSON.parse(init.body) : null });
      if (url.host === 'model.test' || (url.hostname === 'api.openalex.org' && url.pathname.startsWith('/model-fixture/'))) {
        const fixture = { ...globalThis.__modelFixture };
        if (fixture.hold) await new Promise(resolve => { globalThis.__releaseModel = resolve; });
        if (fixture.fail) return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
        const prompt = JSON.stringify(init.body ? JSON.parse(init.body) : {});
        const language = prompt.includes('Write all translated output in French') ? 'fr' : prompt.includes('Write all translated output in German') ? 'de' : prompt.includes('Write all translated output in English') ? 'en' : 'zh-CN';
        const text = {
          'zh-CN': { titleTranslated: '测量中的证据与不确定性', abstractTranslated: '在 120 个样本中，未观察到显著增加。', summary: '该研究在 120 个样本中未发现显著增加。' },
          en: { titleTranslated: 'Evidence and uncertainty in measurement', abstractTranslated: 'In 120 samples, no significant increase was observed.', summary: 'The study found no significant increase in 120 samples.' },
          fr: { titleTranslated: 'Preuves et incertitude dans la mesure', abstractTranslated: 'Dans 120 échantillons, aucune augmentation significative n’a été observée.', summary: 'L’étude n’a constaté aucune augmentation significative dans 120 échantillons.' },
          de: { titleTranslated: 'Belege und Unsicherheit bei der Messung', abstractTranslated: 'Bei 120 Stichproben wurde kein signifikanter Anstieg beobachtet.', summary: 'Die Studie fand bei 120 Stichproben keinen signifikanten Anstieg.' },
        };
        const output = prompt.includes('Long abstract measurement study')
          ? { titleTranslated: 'Long abstract translated result', abstractTranslated: 'Across 120 samples, no significant increase was observed; uncertainty remained substantial. '.repeat(55) + 'TRANSLATION_END', summary: 'The study found no significant increase in 120 samples despite substantial uncertainty.' }
          : text[language];
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.host === 'api.openalex.org') {
        if (url.searchParams.get('search') === globalThis.__metadataFixture.holdTitle) {
          await new Promise(resolve => { globalThis.__releaseMetadata = resolve; });
        }
        const work = { id: 'https://openalex.org/W1001', title: 'Evidence and uncertainty in measurement', doi: 'https://doi.org/10.1234/evidence', type: 'article', publication_year: 2024,
          authorships: [{ author: { display_name: 'Alice Smith' } }, { author: { display_name: 'Bo Chen' } }],
          primary_location: { source: { display_name: 'Measurement Research' }, landing_page_url: `${fixtureOrigin}/source/evidence`, pdf_url: `${fixtureOrigin}/pdf/evidence.pdf`, version: 'publishedVersion' },
          abstract_inverted_index: { 'In': [0], '120': [1], 'samples,': [2], 'no': [3], 'significant': [4], 'increase': [5], 'was': [6], 'observed.': [7] } };
        if (url.searchParams.get('search') === 'Long abstract measurement study') {
          work.id = 'https://openalex.org/W1002';
          work.title = 'Long abstract measurement study';
          work.doi = 'https://doi.org/10.1234/long-abstract';
          work.primary_location.landing_page_url = `${fixtureOrigin}/source/long-abstract`;
          work.primary_location.pdf_url = `${fixtureOrigin}/pdf/long-abstract.pdf`;
          work.abstract_inverted_index = {};
          const abstract = 'In 120 samples, no significant increase was observed; repeated measurements retained substantial uncertainty. '.repeat(55) + 'ORIGINAL_END';
          abstract.split(' ').forEach((word, index) => (work.abstract_inverted_index[word] ??= []).push(index));
        }
        const extras = {
          'Paper removed from the collection': ['W1003', 'removed'],
          'Paper without a direct PDF': ['W1004', 'missing'],
          'Paper requiring publisher authentication': ['W1005', 'auth'],
          'Background completed after closing search': ['W1006', 'background'],
          'Unsaved durable preview': ['W1007', 'unsaved'],
        };
        const extra = extras[url.searchParams.get('search')];
        if (extra) {
          work.id = `https://openalex.org/${extra[0]}`;
          work.title = url.searchParams.get('search');
          work.doi = `https://doi.org/10.1234/${extra[1]}`;
          work.primary_location.landing_page_url = `${fixtureOrigin}/source/${extra[1]}`;
          work.primary_location.pdf_url = extra[1] === 'auth' ? `${fixtureOrigin}/pdf/auth.pdf` : null;
        }
        return new Response(JSON.stringify({ results: [work] }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error('Test blocked external request');
    };
  }, fixtureOrigin);
  await installWorkerFixture(worker);
  await enableHoverFixture(context, id);

  const options = await context.newPage();
  const downloadControl = await context.newCDPSession(options);
  // CDP's "allow" override discards Chrome extension-supplied filenames. Use
  // normal browser naming with the above disposable-profile download preference.
  await downloadControl.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
  options.on('pageerror', e => workerErrors.push(e.message));
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.locator('#status').filter({ hasText: '配置已读取' }).waitFor();
  check('session key is default', !await options.locator('#remember-key').isChecked());
  await options.evaluate(() => { chrome.permissions.request = async ({ origins }) => origins.length === 1 && (origins[0] === 'https://model.test/*' || origins[0].startsWith('https://api.openalex.org')); });
  await options.locator('#base-url').fill(`${modelOrigin}/model-fixture/v1`);
  await options.locator('#model').fill('fixture-model');
  await options.locator('#api-key').fill('TEST_ONLY_SECRET_NOT_REAL');
  await options.locator('#consent').check();
  await options.getByRole('button', { name: '保存配置' }).click();
  await options.locator('#status').filter({ hasText: '配置已保存' }).waitFor();
  check('password field cleared after save', await options.locator('#api-key').inputValue() === '');
  const keyStorage = await worker.evaluate(async () => ({ local: (await chrome.storage.local.get(null)).apiKey, session: (await chrome.storage.session.get(null)).apiKey }));
  check('key stored only in session', keyStorage.local === undefined && keyStorage.session === 'TEST_ONLY_SECRET_NOT_REAL');
  await options.screenshot({ path: path.join(results, 'options.png'), fullPage: true });
  await options.getByRole('button', { name: '测试连接' }).click();
  await options.locator('#status').filter({ hasText: '连接测试完成' }).waitFor();

  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:16px/1.6 system-ui;margin:0;color:#253b4a;background:#fbfcfd}header{padding:20px 60px;border-bottom:1px solid #dce5e8;background:#fff}main{margin:36px 80px;max-width:720px}.gs_rt{margin:0}.gs_rt a{color:#1a4898;font-size:20px;text-decoration:none}.gs_a{color:#49735a;font-size:14px}.gs_rs{font-size:14px;color:#546977}.gs_r{margin:34px 0}small{color:#637986}</style><header><strong>文献检索 · 离线验收页面</strong><br><small>构造的测试条目；所有 API 响应均为离线夹具，不访问 Scholar 或付费模型。</small></header><main><div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://example.org/evidence">Evidence and uncertainty in measurement</a></h3><div class="gs_a">A Smith, B Chen - Measurement Research, 2024 - example.org</div><div class="gs_rs">A study of uncertainty across measurement samples. Hover to inspect the source-backed preview.</div></div><div class="gs_r gs_or gs_scl"><h3 class="gs_rt"><a href="https://example.org/unknown">An ambiguous study of another subject</a></h3><div class="gs_a">C Jones - Example Journal, 2020 - example.org</div><div class="gs_rs">This intentionally mismatched entry exercises explicit candidate confirmation.</div></div></main></html>`;
  await context.route('https://scholar.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  const page = await context.newPage();
  page.on('pageerror', e => workerErrors.push(e.message));
  await page.goto('https://scholar.google.com/scholar?q=offline-fixture');
  const first = page.locator('.gs_rt a').first();
  const host = page.locator('#scholar-hover-card');
  await host.waitFor({ state: 'attached' });
  await first.hover();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(650);
  check('quick hover does not request metadata', !(await worker.evaluate(() => globalThis.__requests)).some(r => r.host === 'api.openalex.org' && !r.path.startsWith('/model-fixture/')));
  modelFixture.delayMs = slowModelDelayMs;
  const slowGenerationStarted = Date.now();
  await first.hover();
  try { await host.getByText('中文信息已生成。', { exact: true }).waitFor({ timeout: 45_000 }); }
  catch (error) {
    const diagnostics = {
      card: await host.locator('section').textContent().catch(() => ''),
      status: await host.locator('.status').first().textContent().catch(() => ''),
      contexts: await worker.evaluate(async () => (await chrome.runtime.getContexts({})).map(context => ({ type: context.contextType, url: context.documentUrl }))),
      modelRequestCount: modelRequests.length,
      workerErrors,
    };
    throw new Error(`Slow offscreen generation failed: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  check('offscreen worker completes after more than the service-worker response limit', slowModelDelayMs < 30_000 || Date.now() - slowGenerationStarted >= 30_000);
  check('original title retained', await host.getByRole('heading').textContent() === 'Evidence and uncertainty in measurement');
  check('Chinese title visible', await host.getByText('测量中的证据与不确定性', { exact: true }).count() === 1);
  check('abstract-based summary labelled', (await host.textContent()).includes('基于论文摘要') || (await host.locator('section').textContent()).includes('基于论文摘要'));
  await host.getByRole('button', { name: '固定', exact: true }).click();
  await page.locator('.gs_rt a').nth(1).hover();
  await page.waitForTimeout(650);
  check('pin preserves current paper', await host.getByRole('heading').textContent() === 'Evidence and uncertainty in measurement');
  await page.screenshot({ path: path.join(results, 'hover-card.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await host.waitFor({ state: 'hidden' });
  const before = modelRequests.length;
  await first.hover();
  await host.getByText('已读取本地缓存。', { exact: true }).waitFor();
  check('repeat hover reuses generated cache', modelRequests.length === before);
  await page.keyboard.press('Escape');
  await page.locator('.gs_rt a').nth(1).hover();
  await host.getByText('请选择匹配条目').waitFor();
  check('ambiguous result not auto-generated', modelRequests.length === before);
  await host.locator('[data-action="confirm"]').first().click();
  await host.locator('summary').waitFor();
  check('confirmed candidate retains real abstract', (await host.locator('details').textContent()).includes('120 samples'));
  await page.keyboard.press('Escape');

  // DOM-ready/first-frame timing under cached, fully local test conditions (not Internet/model latency).
  await page.evaluate(() => {
    globalThis.__latencies = [];
    let entered = 0;
    document.addEventListener('mouseover', e => { if (e.target.closest?.('.gs_rt')) entered = performance.now(); }, true);
    const element = document.getElementById('scholar-hover-card');
    new MutationObserver(() => {
      if (element.style.display === 'block' && entered) { const start = entered; entered = 0; requestAnimationFrame(() => globalThis.__latencies.push(performance.now() - start - 500)); }
    }).observe(element, { attributes: true, attributeFilter: ['style'] });
  });
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(0, 0);
    await first.hover();
    await host.waitFor({ state: 'visible' });
    await page.waitForTimeout(40);
    await page.keyboard.press('Escape');
  }
  const latencies = await page.evaluate(() => globalThis.__latencies);
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  check('collected 20 cached first-frame samples', sorted.length === 20);
  check('cached first-frame p95 <= 150 ms after dwell', p95 <= 150);
  const generations = async () => modelRequests.length;
  const setLanguages = async (uiLanguage, outputLanguage) => {
    await options.bringToFront();
    await options.locator('#ui-language').selectOption(uiLanguage);
    await options.locator('#output-language').selectOption(outputLanguage);
    await options.locator('button[type="submit"]').click();
    await waitUntil(() => options.evaluate(async expected => {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      return response.ok && response.data.uiLanguage === expected.uiLanguage && response.data.outputLanguage === expected.outputLanguage;
    }, { uiLanguage, outputLanguage }), 'language settings must be saved');
    check(uiLanguage + ' options document language set', await options.locator('html').getAttribute('lang') === uiLanguage);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    // Esc closes the previous card while the pointer can remain on the title.
    // Leave the title before the next hover so the browser emits a new entry event.
    await page.mouse.move(0, 0);
  };
  await setLanguages('fr', 'de');
  const beforeGerman = await generations();
  await first.hover();
  await host.getByText('Belege und Unsicherheit bei der Messung', { exact: true }).waitFor();
  check('French card UI with independent German output', await host.locator('[data-action="close"]').textContent() === 'Fermer');
  check('new output language triggers one generation', await generations() === beforeGerman + 1);
  await host.locator('summary').click();
  check('German abstract retains the fixture negation and number', (await host.locator('details').textContent()).includes('120 Stichproben wurde kein'));
  await page.screenshot({ path: path.join(results, 'hover-card-fr-de.png'), fullPage: true });
  await options.screenshot({ path: path.join(results, 'options-fr.png'), fullPage: true });
  await page.keyboard.press('Escape');

  const beforeUiOnly = await generations();
  await setLanguages('de', 'de');
  await first.hover();
  await host.getByText('Belege und Unsicherheit bei der Messung', { exact: true }).waitFor();
  check('German card UI is localized', await host.locator('[data-action="close"]').textContent() === 'Schließen');
  check('interface-only change reuses generated cache', await generations() === beforeUiOnly);
  await options.screenshot({ path: path.join(results, 'options-de.png'), fullPage: true });
  await page.keyboard.press('Escape');

  await setLanguages('en', 'fr');
  await first.hover();
  await host.getByText('Preuves et incertitude dans la mesure', { exact: true }).waitFor();
  check('English card UI with independent French output', await host.locator('[data-action="close"]').textContent() === 'Close');
  await page.keyboard.press('Escape');
  await setLanguages('en', 'en');
  await first.hover();
  await host.getByText('English text generated.', { exact: true }).waitFor();
  await host.locator('summary').click();
  check('English output preserves original abstract meaning in fixture', (await host.locator('details').textContent()).includes('no significant increase'));
  await page.keyboard.press('Escape');
  const beforeChinese = await generations();
  await setLanguages('zh-CN', 'zh-CN');
  await first.hover();
  await host.getByText('已读取本地缓存。', { exact: true }).waitFor();
  check('switching back restores the Chinese cache', await generations() === beforeChinese);

  // Exercise real overflow, dock resizing and pending/error UI with a long paper.
  // The model can be held until the browser has inspected the pending state.
  await page.keyboard.press('Escape');
  await setLanguages('en', 'en');
  const configureManualModel = async model => {
    await options.bringToFront();
    await options.locator('#auto-generate').uncheck();
    await options.locator('#model').fill(model);
    await options.locator('button[type="submit"]').click();
    await waitUntil(() => options.evaluate(async expected => {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      return response.ok && response.data.model === expected && response.data.autoGenerate === false;
    }, model), 'manual model settings must be saved');
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.mouse.move(0, 0);
  };
  const visibleWithinCard = locator => locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const root = element.getRootNode();
    const card = root.host.getBoundingClientRect();
    const hit = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && rect.top >= Math.max(0, card.top) - 1
      && rect.bottom <= Math.min(innerHeight, card.bottom) + 1
      && rect.left >= Math.max(0, card.left) - 1 && rect.right <= Math.min(innerWidth, card.right) + 1
      && (hit === element || element.contains(hit));
  });
  const cardBounds = () => host.boundingBox();
  const withinViewport = async () => {
    const bounds = await cardBounds();
    const viewport = page.viewportSize();
    return bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1;
  };
  const body = host.locator('.body');
  const scrollToBottom = async () => {
    const bounds = await body.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 30000);
    await page.waitForFunction(() => {
      const body = document.getElementById('scholar-hover-card')?.shadowRoot?.querySelector('.body');
      return body && body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
    });
  };
  const releaseModel = async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (heldModelRequests.length) {
        heldModelRequests.shift()();
        modelFixture.hold = false;
        return;
      }
      await page.waitForTimeout(100);
    }
    assert.fail('manual generation must reach the held model request');
  };
  const resizeEdgeBy = async (edge, delta) => {
    const handle = await host.locator(`.resize-handle[data-edge="${edge}"]`).boundingBox();
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + delta, { steps: 8 });
    await page.mouse.up();
  };
  await configureManualModel('fixture-manual-success');
  await page.evaluate(() => {
    document.body.style.minHeight = '2400px';
    const result = document.createElement('div');
    result.className = 'gs_r gs_or gs_scl';
    result.innerHTML = '<h3 class="gs_rt"><a href="https://example.org/long-abstract">Long abstract measurement study</a></h3><div class="gs_a">A Smith, B Chen - Measurement Research, 2024 - example.org</div><div class="gs_rs">A long offline abstract for scroll, resize and manual generation checks.</div>';
    document.querySelector('main').append(result);
  });
  const longTitle = page.getByRole('link', { name: 'Long abstract measurement study', exact: true });
  const beforeManual = await generations();
  await longTitle.hover();
  await host.locator('[data-action="generate"]').waitFor();
  check('manual mode does not issue a model request on hover', await generations() === beforeManual);
  const initialDock = await cardBounds();
  check('paper card docks to the right with fixed width and full viewport height', initialDock.x + initialDock.width === 1280 && initialDock.y === 0 && initialDock.width === 420 && initialDock.height === 900);
  await host.locator('summary').click();
  check('long original abstract creates a bounded scroll container', await body.evaluate(element => element.scrollHeight > element.clientHeight + 1000) && await withinViewport());
  const pageScrollBefore = await page.evaluate(() => scrollY);
  const headerBeforeScroll = await host.locator('.head').boundingBox();
  await scrollToBottom();
  check('wheel reaches the long original abstract end', await body.evaluate(element => {
    const paragraph = element.querySelector('details p');
    const text = paragraph.firstChild;
    const range = document.createRange();
    range.setStart(text, text.length - 'ORIGINAL_END'.length); range.setEnd(text, text.length);
    const tail = range.getBoundingClientRect(); const bounds = element.getBoundingClientRect();
    return paragraph.textContent.endsWith('ORIGINAL_END') && tail.top >= bounds.top && tail.bottom <= bounds.bottom + 1;
  }));
  check('manual generate action remains reachable below a long abstract', await visibleWithinCard(host.locator('[data-action="generate"]')));
  const beforeGeneratePosition = await cardBounds();
  const beforeGenerateScroll = await body.evaluate(element => element.scrollTop);
  modelFixture = { hold: true, fail: false, delayMs: 0 };
  await host.locator('[data-action="generate"]').click();
  await host.locator('.status').filter({ hasText: 'Generating English text…' }).waitFor();
  check('manual click immediately exposes a visible pending status', await visibleWithinCard(host.locator('.status')));
  check('pending generation disables its action', await host.locator('[data-action="generate"]').isDisabled());
  const duringGeneratePosition = await cardBounds();
  check('generate button click does not move the card or reset the abstract', Math.abs(duringGeneratePosition.x - beforeGeneratePosition.x) < 1 && Math.abs(duringGeneratePosition.y - beforeGeneratePosition.y) < 1 && Math.abs(await body.evaluate(element => element.scrollTop) - beforeGenerateScroll) < 2 && await host.locator('details').evaluate(element => element.open));
  await page.screenshot({ path: path.join(results, 'manual-generation-pending.png'), fullPage: false });
  await releaseModel();
  await host.locator('.status').filter({ hasText: 'English text generated.' }).waitFor();
  check('one manual click produces one model request and translated output', await generations() === beforeManual + 1 && (await host.locator('details').textContent()).includes('TRANSLATION_END'));
  await scrollToBottom();
  check('wheel reaches the complete translated abstract end', await body.evaluate(element => {
    const paragraph = element.querySelector('details p:last-child');
    const text = paragraph.firstChild;
    const range = document.createRange();
    range.setStart(text, text.length - 'TRANSLATION_END'.length); range.setEnd(text, text.length);
    const tail = range.getBoundingClientRect(); const bounds = element.getBoundingClientRect();
    return paragraph.textContent.endsWith('TRANSLATION_END') && tail.top >= bounds.top && tail.bottom <= bounds.bottom + 1;
  }));
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(150);
  check('wheel at card boundary does not scroll the Scholar page', await page.evaluate(() => scrollY) === pageScrollBefore);
  const headerAfterScroll = await host.locator('.head').boundingBox();
  check('scrolling keeps header, close and footer actions reachable', Math.abs(headerBeforeScroll.y - headerAfterScroll.y) < 1 && await visibleWithinCard(host.locator('[data-action="close"]')) && await visibleWithinCard(host.locator('[data-action="copy"]')));
  await page.screenshot({ path: path.join(results, 'long-abstract-bottom.png'), fullPage: false });

  // Resizing establishes its own pinned state and keeps the panel right docked.
  await host.locator('[data-action="pin"]').click();
  check('pin button click toggles without moving the card', await host.locator('[data-action="pin"]').getAttribute('aria-pressed') === 'false' && Math.abs((await cardBounds()).x - duringGeneratePosition.x) < 1 && Math.abs((await cardBounds()).y - duringGeneratePosition.y) < 1);
  await resizeEdgeBy('bottom', -180);
  const shortened = await cardBounds();
  check('bottom edge shortens and pins the right-docked panel', shortened.height < 780 && shortened.y === 0 && shortened.width === 420 && shortened.x + shortened.width === 1280 && await host.locator('[data-action="pin"]').getAttribute('aria-pressed') === 'true');
  check('resize auto-pin clears an outdated unpinned status', !((await host.locator('.status').first().textContent()).includes('Card unpinned.')));
  await resizeEdgeBy('bottom', 100);
  check('bottom edge can lengthen the panel again', (await cardBounds()).height > shortened.height + 80 && await withinViewport());
  const beforeTopResize = await cardBounds();
  await resizeEdgeBy('top', 140);
  const topResized = await cardBounds();
  check('top edge shortens panel while preserving its bottom edge', topResized.y > 100 && Math.abs(topResized.y + topResized.height - beforeTopResize.height) < 2 && await withinViewport());
  await page.locator('.gs_rt a').nth(1).hover();
  await page.waitForTimeout(650);
  check('resized card stays pinned while another result is hovered', await host.getByRole('heading').textContent() === 'Long abstract measurement study');
  check('resized panel keeps close and collection actions accessible', await visibleWithinCard(host.locator('[data-action="close"]')) && await visibleWithinCard(host.locator('[data-action="collection"]')));
  await page.screenshot({ path: path.join(results, 'resized-sidebar.png'), fullPage: false });
  await host.locator('[data-action="reset-height"]').click();
  check('reset height restores full viewport height on the right', (await cardBounds()).y === 0 && (await cardBounds()).height === 900 && (await cardBounds()).x + (await cardBounds()).width === 1280);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForFunction(() => {
    const bounds = document.getElementById('scholar-hover-card')?.getBoundingClientRect();
    return bounds?.width === 320 && bounds?.height === 640;
  });
  check('sidebar fits a narrow resized browser viewport', await withinViewport() && (await cardBounds()).width === 320 && (await cardBounds()).height === 640);
  await page.setViewportSize({ width: 1280, height: 900 });
  await host.locator('[data-action="reset-height"]').click();
  await host.locator('[data-action="close"]').click();
  await host.waitFor({ state: 'hidden' });
  check('close button closes the resized sidebar', !await host.isVisible());

  await configureManualModel('fixture-manual-retry');
  modelFixture = { hold: false, fail: true, delayMs: 0 };
  await longTitle.hover();
  await host.locator('[data-action="generate"]').waitFor();
  await host.locator('summary').click();
  await scrollToBottom();
  const beforeFailure = await generations();
  await host.locator('[data-action="generate"]').click();
  await host.locator('.status.failure').waitFor();
  check('manual model failure has visible feedback and an enabled retry', await visibleWithinCard(host.locator('.status.failure')) && await visibleWithinCard(host.locator('[data-action="generate"]')) && !await host.locator('[data-action="generate"]').isDisabled() && (await host.locator('.status.failure').textContent()).trim().length > 0);
  check('manual model failure sends exactly one request', await generations() === beforeFailure + 1);
  await page.screenshot({ path: path.join(results, 'manual-generation-failed.png'), fullPage: false });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await host.locator('[data-action="pin"]').click();
  await host.locator('[data-action="pin"]').click();
  await page.waitForTimeout(650);
  check('failed generation does not retry after focus or pin redraws', await generations() === beforeFailure + 1);
  modelFixture = { hold: true, fail: false, delayMs: 0 };
  await host.locator('[data-action="generate"]').click();
  await host.locator('.status').filter({ hasText: 'Generating English text…' }).waitFor();
  await releaseModel();
  await host.locator('.status').filter({ hasText: 'English text generated.' }).waitFor();
  check('explicit retry succeeds with exactly one further request', await generations() === beforeFailure + 2 && (await host.locator('details').textContent()).includes('TRANSLATION_END'));

  // Exercise the saved collection through content buttons and the real extension page.
  // Inspect persisted storage from the worker; collection RPCs are intentionally
  // forbidden in the options page and Scholar content script.
  const getCollection = () => worker.evaluate(async () => (await chrome.storage.local.get('savedCollection')).savedCollection);
  const saveCurrent = async expectedCount => {
    await host.locator('[data-action="save"]').click();
    await host.locator('[data-action="save"]').filter({ hasText: /Saved|cached|已缓存/i }).waitFor();
    assert.equal((await getCollection()).items.length, expectedCount, 'Save action must persist the expected unique paper count');
  };
  await saveCurrent(1);
  check('save paper stores the complete original and translated long abstracts', (await getCollection()).items[0].paper.abstract.endsWith('ORIGINAL_END') && (await getCollection()).items[0].generated.abstractTranslated.endsWith('TRANSLATION_END'));
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await first.hover();
  await host.locator('[data-action="generate"]').waitFor();
  await host.locator('[data-action="generate"]').click();
  await host.locator('.status').filter({ hasText: 'English text generated.' }).waitFor();
  await saveCurrent(2);
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await first.hover();
  await host.locator('summary').waitFor();
  await saveCurrent(2);
  check('saving an existing paper updates it without duplicating or changing its first-save order', (await getCollection()).items.map(item => item.paper.title).join('|') === 'Long abstract measurement study|Evidence and uncertainty in measurement');
  await page.keyboard.press('Escape');
  const extraTitles = ['Paper removed from the collection', 'Paper without a direct PDF', 'Paper requiring publisher authentication'];
  await page.evaluate(titles => {
    titles.forEach((title, index) => {
      const row = document.createElement('div');
      row.className = 'gs_r gs_or gs_scl';
      const heading = document.createElement('h3'); heading.className = 'gs_rt';
      const link = document.createElement('a'); link.href = `https://example.org/extra-${index}`; link.textContent = title; heading.append(link);
      const meta = document.createElement('div'); meta.className = 'gs_a'; meta.textContent = 'A Smith, B Chen - Measurement Research, 2024 - example.org';
      row.append(heading, meta); document.querySelector('main').append(row);
    });
  }, extraTitles);
  for (let index = 0; index < extraTitles.length; index++) {
    await page.getByRole('link', { name: extraTitles[index], exact: true }).hover();
    await host.locator('[data-action="generate"]').waitFor();
    await saveCurrent(3 + index);
    if (index < extraTitles.length - 1) await page.keyboard.press('Escape');
  }
  const managerPromise = context.waitForEvent('page');
  await host.locator('[data-action="collection"]').click();
  const manager = await managerPromise;
  manager.on('pageerror', error => workerErrors.push(error.message));
  await manager.waitForURL(`chrome-extension://${id}/collection.html`);
  await manager.locator('#paper-list > li').nth(4).waitFor();
  await waitUntil(async () => (await getCollection()).items.every(item => item.completion?.status === 'ready'), 'saved papers must finish their background completion before export');
  await manager.locator('.paper-completion[data-completion="ready"]').nth(4).waitFor();
  check('download cached papers opens the collection manager with click order preserved', (await manager.locator('.paper-title').allTextContents()).join('|') === ['Long abstract measurement study', 'Evidence and uncertainty in measurement', ...extraTitles].join('|'));
  const removable = manager.locator('#paper-list > li').filter({ hasText: 'Paper removed from the collection' });
  await removable.locator('[data-action="remove"]').click();
  await removable.waitFor({ state: 'detached' });
  check('removing a paper updates both saved collection and manager list', (await getCollection()).items.length === 4 && await manager.locator('#paper-list > li').count() === 4);
  const evidenceRow = manager.locator('#paper-list > li').filter({ hasText: 'Evidence and uncertainty in measurement' }).first();
  const longRow = manager.locator('#paper-list > li').filter({ hasText: 'Long abstract measurement study' }).first();
  // Removal preserves scroll position. Keep the native drag's destination in
  // view so Playwright does not scroll the document while the pointer is down.
  await longRow.scrollIntoViewIfNeeded();
  await evidenceRow.locator('[data-action="drag"]').dragTo(longRow, { targetPosition: { x: 100, y: 12 } });
  await manager.waitForFunction(() => document.querySelector('#paper-list > li .paper-title')?.textContent === 'Evidence and uncertainty in measurement');
  check('native drag reorders cached papers and renumbers the list', (await getCollection()).items[0].paper.title === 'Evidence and uncertainty in measurement' && (await manager.locator('.paper-number').allTextContents()).join(',') === '1,2,3,4');
  await manager.reload();
  await manager.locator('#paper-list > li').nth(3).waitFor();
  check('collection order survives a manager page reload', (await manager.locator('.paper-title').allTextContents()).join('|') === ['Evidence and uncertainty in measurement', 'Long abstract measurement study', extraTitles[1], extraTitles[2]].join('|'));
  await manager.locator('#preview-details').evaluate(element => { element.open = true; });
  const preview = await manager.locator('#markdown-preview').inputValue();
  check('Markdown preview uses APA-style references and BibTeX with current numbering', preview.indexOf('## 1. Evidence and uncertainty in measurement') < preview.indexOf('## 2. Long abstract measurement study') && preview.includes('APA-style citation') && preview.includes('@misc{paper1,') && preview.includes('@misc{paper4,'));
  await manager.locator('#preview-details').evaluate(element => { element.open = false; });
  const authPagePromise = context.waitForEvent('page');
  await manager.locator('[data-action="export"]').click();
  const authPage = await authPagePromise;
  await authPage.waitForURL(`${fixtureOrigin}/source/missing`);
  check('first unavailable PDF automatically opens its original publisher page', await authPage.locator('h1').textContent() === 'Original article / authentication fixture');
  await manager.bringToFront();
  await waitUntil(() => manager.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'GET_EXPORT' });
    return result.ok && result.data?.markdown.state === 'complete' && result.data.items.every(item => ['complete', 'failed'].includes(item.state));
  }), 'native downloads must reach terminal states');
  await manager.locator('#download-status [data-download-id="markdown"] .download-state[data-state="complete"]').waitFor();
  const batch = await manager.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'GET_EXPORT' })).data);
  check('export reports successful Markdown and PDF files alongside each failure', batch.markdown.state === 'complete' && batch.items.map(item => item.state).join(',') === 'complete,complete,failed,failed');
  const nativeDownloads = await worker.evaluate(async () => chrome.downloads.search({}));
  await writeFile(path.join(results, 'native-downloads-initial.json'), JSON.stringify(nativeDownloads, null, 2));
  const markdownDownload = nativeDownloads.find(item => item.id === batch.markdown.downloadId);
  const pdfDownloads = batch.items.slice(0, 2).map(item => nativeDownloads.find(download => download.id === item.downloadId));
  check('real Chrome downloads remain inside the isolated temporary directory', [markdownDownload, ...pdfDownloads].every(item => item.filename.startsWith(downloads + path.sep)));
  const markdown = await readFile(markdownDownload.filename, 'utf8');
  await writeFile(path.join(results, 'exported-articles.md'), markdown);
  check('downloaded Markdown equals the reviewed preview including original and translated abstracts', markdown === preview && markdown.includes('ORIGINAL\\_END') && markdown.includes('TRANSLATION\\_END') && !markdown.includes(extraTitles[0]));
  check('real PDF filenames have the same numbers and paper titles as Markdown', path.basename(pdfDownloads[0].filename) === '1-Evidence and uncertainty in measurement.pdf' && path.basename(pdfDownloads[1].filename) === '2-Long abstract measurement study.pdf' && pdfDownloads.every(item => item.mime === 'application/pdf'));
  check('downloaded files contain PDF bytes rather than an authentication page', (await Promise.all(pdfDownloads.map(item => readFile(item.filename)))).every(bytes => bytes.equals(fixturePdf)));
  const htmlItem = batch.items[3];
  const htmlDownload = nativeDownloads.find(item => item.id === htmlItem.downloadId);
  const htmlExists = await access(htmlDownload.filename).then(() => true, () => false);
  check('HTML returned by a PDF URL is marked failed and its invalid downloaded file is removed', htmlItem.state === 'failed' && !htmlExists && /PDF/.test(htmlItem.error));
  check('missing and authentication failures expose source links and explicit retries', await manager.locator('#download-status .download-state[data-state="failed"]').count() === 2 && await manager.locator('#download-status [data-action="retry"]').count() === 2 && await manager.locator('#download-status .download-actions a').count() >= 2);
  await manager.screenshot({ path: path.join(results, 'collection-downloads.png'), fullPage: true });
  authorizedPdf = true;
  await manager.locator(`#download-status [data-download-id="${htmlItem.id}"] [data-action="retry"]`).click();
  await manager.locator(`#download-status [data-download-id="${htmlItem.id}"] .download-state[data-state="complete"]`).waitFor();
  const retried = await manager.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'GET_EXPORT' })).data);
  const retriedTransfer = (await worker.evaluate(async id => chrome.downloads.search({ id }), retried.items[3].downloadId))[0];
  check('explicit retry downloads the PDF using its original export number', retried.items[3].number === 4 && retriedTransfer.state === 'complete' && path.basename(retriedTransfer.filename) === '4-Paper requiring publisher authentication.pdf' && (await readFile(retriedTransfer.filename)).equals(fixturePdf));
  const downloadEvidence = {
    initialBatch: batch, afterRetry: retried,
    nativeTransferCount: (await worker.evaluate(async () => chrome.downloads.search({}))).length,
    files: [markdownDownload, ...pdfDownloads, retriedTransfer].map(item => ({ filename: path.basename(item.filename), state: item.state, mime: item.mime, bytes: item.fileSize })),
    invalidHtmlFileRemoved: !htmlExists,
    isolation: 'Chrome profile and native downloads were confined to a disposable test directory. Only generated Markdown, one artificial one-page PDF and this metadata report are retained.',
  };
  await writeFile(path.join(results, 'exported-sample.pdf'), await readFile(pdfDownloads[0].filename));
  await writeFile(path.join(results, 'native-downloads.json'), JSON.stringify(downloadEvidence, null, 2));
  await manager.screenshot({ path: path.join(results, 'collection-retry-complete.png'), fullPage: true });

  const addResult = (target, title, slug) => target.evaluate(({ title, slug }) => {
    const row = document.createElement('div'); row.className = 'gs_r gs_or gs_scl';
    const heading = document.createElement('h3'); heading.className = 'gs_rt';
    const link = document.createElement('a'); link.href = `https://example.org/${slug}`; link.textContent = title; heading.append(link);
    const meta = document.createElement('div'); meta.className = 'gs_a'; meta.textContent = 'A Smith, B Chen - Measurement Research, 2024 - example.org';
    row.append(heading, meta); document.querySelector('main').append(row);
  }, { title, slug });
  const metadataCount = () => worker.evaluate(() => globalThis.__requests.filter(request => request.host === 'api.openalex.org' && !request.path.startsWith('/model-fixture/')).length);
  const backgroundTitle = 'Background completed after closing search';
  await worker.evaluate(title => { globalThis.__metadataFixture.holdTitle = title; }, backgroundTitle);
  modelFixture.hold = true;
  const backgroundPage = await context.newPage();
  backgroundPage.on('pageerror', error => workerErrors.push(error.message));
  await backgroundPage.goto('https://scholar.google.com/scholar?q=background-save');
  await addResult(backgroundPage, backgroundTitle, 'background');
  await backgroundPage.getByRole('link', { name: backgroundTitle, exact: true }).hover();
  const backgroundHost = backgroundPage.locator('#scholar-hover-card');
  await backgroundHost.locator('[data-action="save"]').waitFor();
  await waitUntil(() => worker.evaluate(() => typeof globalThis.__releaseMetadata === 'function'), 'metadata lookup must remain held before early save');
  const earlySaveStarted = Date.now();
  await backgroundHost.locator('[data-action="save"]').click();
  await backgroundHost.locator('[data-action="save"]').filter({ hasText: 'Saved' }).waitFor({ timeout: 2500 });
  const earlySaveMs = Date.now() - earlySaveStarted;
  const pendingSaved = (await getCollection()).items.find(item => item.paper.title === backgroundTitle);
  check('saving acknowledges locally while metadata is still blocked', earlySaveMs < 2500 && !!pendingSaved && !pendingSaved.generated && ['queued', 'resolving'].includes(pendingSaved.completion.status));
  await backgroundPage.close();
  const beforeBackgroundModel = modelRequests.length;
  await worker.evaluate(() => { globalThis.__metadataFixture.holdTitle = ''; globalThis.__releaseMetadata(); delete globalThis.__releaseMetadata; });
  await waitUntil(() => Promise.resolve(modelRequests.length > beforeBackgroundModel), 'background generation must start after the source search page closes');
  await manager.reload();
  const backgroundRow = manager.locator('#paper-list > li').filter({ hasText: backgroundTitle });
  await backgroundRow.locator('[data-completion="generating"]').waitFor();
  check('manager exposes translation progress after the search page closes', backgroundPage.isClosed() && !await backgroundRow.locator('[data-completion="ready"]').count());
  modelFixture.hold = false;
  while (heldModelRequests.length) heldModelRequests.shift()();
  await backgroundRow.locator('[data-completion="ready"]').waitFor({ timeout: 15000 });
  const completedSaved = (await getCollection()).items.find(item => item.paper.title === backgroundTitle);
  check('background completion persists metadata, translation and summary without its search page', completedSaved.completion.status === 'ready' && completedSaved.paper.abstract.includes('120 samples') && completedSaved.generated.abstractTranslated.includes('no significant increase') && !!completedSaved.generated.summary);
  await manager.screenshot({ path: path.join(results, 'background-save-complete.png'), fullPage: true });

  const unsavedTitle = 'Unsaved durable preview';
  const unsavedPage = await context.newPage();
  unsavedPage.on('pageerror', error => workerErrors.push(error.message));
  await unsavedPage.goto('https://scholar.google.com/scholar?q=unsaved-archive');
  await addResult(unsavedPage, unsavedTitle, 'unsaved');
  await unsavedPage.getByRole('link', { name: unsavedTitle, exact: true }).hover();
  const unsavedHost = unsavedPage.locator('#scholar-hover-card');
  await unsavedHost.locator('[data-action="generate"]').click();
  await unsavedHost.locator('.status').filter({ hasText: 'English text generated.' }).waitFor();
  check('viewed generated paper is archived without explicit saving', !(await getCollection()).items.some(item => item.paper.title === unsavedTitle));
  const unsavedMetadataCount = await metadataCount();
  const unsavedModelCount = modelRequests.length;
  await unsavedPage.close();
  const revisitPage = await context.newPage();
  revisitPage.on('pageerror', error => workerErrors.push(error.message));
  await revisitPage.goto('https://scholar.google.com/scholar?q=unsaved-revisit');
  await addResult(revisitPage, unsavedTitle, 'unsaved');
  await revisitPage.getByRole('link', { name: unsavedTitle, exact: true }).hover();
  const revisitHost = revisitPage.locator('#scholar-hover-card');
  await revisitHost.getByText('Loaded from local cache.', { exact: true }).waitFor();
  check('reopening an unsaved preview restores complete output without metadata or model calls', await metadataCount() === unsavedMetadataCount && modelRequests.length === unsavedModelCount && (await revisitHost.locator('details').textContent()).includes('no significant increase'));
  await revisitPage.close();

  const requestLog = [...await worker.evaluate(() => globalThis.__requests), ...modelRequests];
  check('no secret in page DOM', !await page.evaluate(() => document.documentElement.outerHTML.includes('TEST_ONLY_SECRET_NOT_REAL')));
  const timings = await worker.evaluate(async () => { const data = await chrome.storage.session.get(['lastModelTiming', 'paperRegistry']); return { model: data.lastModelTiming, metadata: data.paperRegistry?.map(e => e.resolution.timings).filter(Boolean) }; });
  check('provider round-trip diagnostics recorded locally', typeof timings.model?.durationMs === 'number' && timings.metadata.some(t => typeof t.openalex === 'number'));
  // Restart the whole isolated browser, not just a page: session storage, content
  // memoization and worker Maps disappear, while the profile's IndexedDB remains.
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ 'generated:legacy-browser-migration': {
      language: 'en', titleTranslated: 'Archived from an older version', abstractTranslated: 'An aged translated abstract.', summary: 'An aged summary.', model: 'legacy-model', fingerprint: 'legacy-browser-migration', createdAt: 1,
    } });
  });
  await context.close();
  context = await chromium.launchPersistentContext(profile, launchOptions);
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
  assert.equal(new URL(worker.url()).host, id, 'The restarted browser must use the same installed extension and storage origin');
  await installWorkerFixture(worker);
  await enableHoverFixture(context, id);
  await context.route('https://scholar.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  const restartedKeys = await worker.evaluate(async () => ({ local: (await chrome.storage.local.get(null)).apiKey, session: (await chrome.storage.session.get(null)).apiKey }));
  check('real browser restart clears the session API key', restartedKeys.local === undefined && restartedKeys.session === undefined);
  const restartModelCount = modelRequests.length;
  const restartedPage = await context.newPage();
  restartedPage.on('pageerror', error => workerErrors.push(error.message));
  await restartedPage.goto('https://scholar.google.com/scholar?q=restart-archive');
  await addResult(restartedPage, unsavedTitle, 'unsaved');
  const neverViewedTitle = 'Never viewed fixture paper';
  await addResult(restartedPage, neverViewedTitle, 'never-viewed');
  await restartedPage.waitForFunction(({ unsavedTitle, neverViewedTitle }) => {
    const rows = [...document.querySelectorAll('.gs_r.gs_or.gs_scl')];
    const state = title => rows.find(row => row.querySelector('.gs_rt a')?.textContent === title)?.dataset.scholarHoverState;
    return state('Evidence and uncertainty in measurement') === 'saved' && state(unsavedTitle) === 'viewed' && state(neverViewedTitle) === 'unviewed';
  }, { unsavedTitle, neverViewedTitle });
  const restartedBadges = await restartedPage.evaluate(() => [...document.querySelectorAll('.gs_r.gs_or.gs_scl')].map(row => ({
    title: row.querySelector('.gs_rt a')?.textContent, state: row.dataset.scholarHoverState, badge: row.querySelector('[data-scholar-hover-badge]')?.textContent,
  })));
  check('previously saved paper restores its Saved badge before any hover after restart', restartedBadges.some(row => row.title === 'Evidence and uncertainty in measurement' && row.state === 'saved' && row.badge === 'Saved'));
  check('unsaved viewed paper restores its Viewed badge before any hover after restart', restartedBadges.some(row => row.title === unsavedTitle && row.state === 'viewed' && row.badge === 'Viewed'));
  check('new paper retains its Not viewed badge without fetching metadata', restartedBadges.some(row => row.title === neverViewedTitle && row.state === 'unviewed' && row.badge === 'Not viewed'));
  check('initial badge restoration uses only local records without metadata or model requests', await metadataCount() === 0 && modelRequests.length === restartModelCount);
  await restartedPage.getByRole('link', { name: unsavedTitle, exact: true }).hover();
  const restartedHost = restartedPage.locator('#scholar-hover-card');
  await restartedHost.getByText('Loaded from local cache.', { exact: true }).waitFor();
  check('real IndexedDB restores an unsaved preview after browser restart without an API key', (await restartedHost.locator('details').textContent()).includes('no significant increase') && await metadataCount() === 0 && modelRequests.length === restartModelCount);
  const archiveEvidence = await worker.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('scholar-hover-archive', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(['generated', 'previews', 'legacyGenerated'], 'readonly');
      const legacy = tx.objectStore('generated').get('legacy-browser-migration');
      const raw = tx.objectStore('legacyGenerated').get('generated:legacy-browser-migration');
      const generatedCount = tx.objectStore('generated').count();
      const previewCount = tx.objectStore('previews').count();
      tx.oncomplete = () => resolve({ legacy: legacy.result, raw: raw.result, generatedCount: generatedCount.result, previewCount: previewCount.result });
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { ...records, source: (await chrome.storage.local.get('generated:legacy-browser-migration'))['generated:legacy-browser-migration'] };
  });
  check('aged legacy storage results migrate into real IndexedDB without expiry or source loss', archiveEvidence.legacy?.createdAt === 1 && archiveEvidence.legacy?.summary === 'An aged summary.' && archiveEvidence.raw?.value?.fingerprint === 'legacy-browser-migration' && archiveEvidence.source === undefined);
  check('durable archive retains both generated results and preview metadata', archiveEvidence.generatedCount >= 2 && archiveEvidence.previewCount >= 2);
  await restartedPage.screenshot({ path: path.join(results, 'restarted-unsaved-preview.png'), fullPage: true });
  requestLog.push(...await worker.evaluate(() => globalThis.__requests));
  check('requests limited to configured providers', requestLog.every(r => r.host === 'model.test' || r.host.startsWith('api.openalex.org')));
  check('no unhandled page errors', workerErrors.length === 0);
  await writeFile(path.join(results, 'e2e.json'), JSON.stringify({ passed: checks, count: checks.length, timestamp: new Date().toISOString(), scope: 'Packaged MV3 extension with metadata/model and permission-boundary doubles; background completion after closing Scholar, real profile restart and IndexedDB migration, actual Chrome downloads from a loopback PDF/auth fixture into an isolated temporary directory. No real Scholar or paid model calls.', cachedFirstFrame: { count: sorted.length, p95Ms: p95, samplesMs: latencies }, durableArchive: { earlySaveMs, generatedCount: archiveEvidence.generatedCount, previewCount: archiveEvidence.previewCount, migratedCreatedAt: archiveEvidence.legacy.createdAt }, timings, errors: workerErrors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, p95Ms: p95, earlySaveMs, screenshots: ['test-results/options.png', 'test-results/hover-card.png', 'test-results/options-fr.png', 'test-results/options-de.png', 'test-results/hover-card-fr-de.png', 'test-results/manual-generation-pending.png', 'test-results/long-abstract-bottom.png', 'test-results/resized-sidebar.png', 'test-results/manual-generation-failed.png', 'test-results/collection-downloads.png', 'test-results/collection-retry-complete.png', 'test-results/background-save-complete.png', 'test-results/restarted-unsaved-preview.png'] }));
} catch (error) {
  const collectionPage = context.pages().find(page => page.url().endsWith('/collection.html'));
  if (collectionPage) {
    await collectionPage.screenshot({ path: path.join(results, 'collection-failure.png'), fullPage: true }).catch(() => {});
    const collectionState = await collectionPage.evaluate(async () => ({
      text: document.body.innerText,
      collection: await chrome.runtime.sendMessage({ type: 'GET_COLLECTION' }),
      export: await chrome.runtime.sendMessage({ type: 'GET_EXPORT' }),
    })).catch(() => undefined);
    await writeFile(path.join(results, 'collection-failure.json'), JSON.stringify({ completedChecks: checks, message: String(error), collectionState }, null, 2));
  }
  const scholarPage = context.pages().find(page => page.url().startsWith('https://scholar.google.com/'));
  if (scholarPage) {
    await scholarPage.screenshot({ path: path.join(results, 'e2e-failure.png'), fullPage: true }).catch(() => {});
    const card = await scholarPage.evaluate(() => {
      const element = document.getElementById('scholar-hover-card');
      const body = element?.shadowRoot?.querySelector('.body');
      return { display: element?.style.display, language: element?.lang, text: element?.shadowRoot?.textContent,
        viewport: { width: innerWidth, height: innerHeight, pageScroll: scrollY }, bounds: element?.getBoundingClientRect().toJSON(),
        body: body ? { bounds: body.getBoundingClientRect().toJSON(), scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : undefined };
    }).catch(() => undefined);
    await writeFile(path.join(results, 'e2e-failure.json'), JSON.stringify({ completedChecks: checks, message: String(error), modelRequests, card }, null, 2));
  }
  throw error;
} finally {
  modelFixture.hold = false;
  while (heldModelRequests.length) heldModelRequests.shift()();
  await context.close();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => modelServer.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
