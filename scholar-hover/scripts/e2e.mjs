import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const results = path.resolve('test-results');
await mkdir(results, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'scholar-hover-e2e-'));
const extension = path.resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const workerErrors = [];
  worker.on('close', () => {});
  // Network-only doubles: real packaged content, options, worker, matching, cache and storage execute.
  // Permission grant/denial logic is unit-tested; native permission dialogs remain a manual check.
  await worker.evaluate(() => {
    globalThis.__requests = [];
    globalThis.__modelFixture = { hold: false, fail: false };
    chrome.permissions.contains = async ({ origins }) => origins?.every(origin => origin === 'https://model.test/*') ?? false;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      globalThis.__requests.push({ host: url.host, path: url.pathname, body: init.body ? JSON.parse(init.body) : null });
      if (url.host === 'model.test') {
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
        const work = { id: 'https://openalex.org/W1001', title: 'Evidence and uncertainty in measurement', doi: 'https://doi.org/10.1234/evidence', type: 'article', publication_year: 2024,
          authorships: [{ author: { display_name: 'Alice Smith' } }, { author: { display_name: 'Bo Chen' } }],
          primary_location: { source: { display_name: 'Measurement Research' }, landing_page_url: 'https://example.org/evidence' },
          abstract_inverted_index: { 'In': [0], '120': [1], 'samples,': [2], 'no': [3], 'significant': [4], 'increase': [5], 'was': [6], 'observed.': [7] } };
        if (url.searchParams.get('search') === 'Long abstract measurement study') {
          work.id = 'https://openalex.org/W1002';
          work.title = 'Long abstract measurement study';
          work.doi = 'https://doi.org/10.1234/long-abstract';
          work.primary_location.landing_page_url = 'https://example.org/long-abstract';
          work.abstract_inverted_index = {};
          const abstract = 'In 120 samples, no significant increase was observed; repeated measurements retained substantial uncertainty. '.repeat(55) + 'ORIGINAL_END';
          abstract.split(' ').forEach((word, index) => (work.abstract_inverted_index[word] ??= []).push(index));
        }
        return new Response(JSON.stringify({ results: [work] }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error('Test blocked external request');
    };
  });

  const options = await context.newPage();
  options.on('pageerror', e => workerErrors.push(e.message));
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.locator('#status').filter({ hasText: '配置已读取' }).waitFor();
  check('session key is default', !await options.locator('#remember-key').isChecked());
  await options.evaluate(() => { chrome.permissions.request = async ({ origins }) => origins.length === 1 && origins[0] === 'https://model.test/*'; });
  await options.locator('#base-url').fill('https://model.test/v1');
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
  check('quick hover does not request metadata', !(await worker.evaluate(() => globalThis.__requests)).some(r => r.host === 'api.openalex.org'));
  await first.hover();
  await host.getByText('中文信息已生成。', { exact: true }).waitFor();
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
  const before = (await worker.evaluate(() => globalThis.__requests)).filter(r => r.host === 'model.test').length;
  await first.hover();
  await host.getByText('已读取本地缓存。', { exact: true }).waitFor();
  check('repeat hover reuses generated cache', (await worker.evaluate(() => globalThis.__requests)).filter(r => r.host === 'model.test').length === before);
  await page.keyboard.press('Escape');
  await page.locator('.gs_rt a').nth(1).hover();
  await host.getByText('请选择匹配条目').waitFor();
  check('ambiguous result not auto-generated', (await worker.evaluate(() => globalThis.__requests)).filter(r => r.host === 'model.test').length === before);
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
  const generations = async () => (await worker.evaluate(() => globalThis.__requests)).filter(r => r.host === 'model.test').length;
  const setLanguages = async (uiLanguage, outputLanguage) => {
    await options.bringToFront();
    await options.locator('#ui-language').selectOption(uiLanguage);
    await options.locator('#output-language').selectOption(outputLanguage);
    await options.locator('button[type="submit"]').click();
    await options.waitForFunction(async expected => {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      return response.ok && response.data.uiLanguage === expected.uiLanguage && response.data.outputLanguage === expected.outputLanguage;
    }, { uiLanguage, outputLanguage });
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

  // Exercise real overflow, pointer capture and pending/error UI with a long paper.
  // The model can be held until the browser has inspected the pending state.
  await page.keyboard.press('Escape');
  await setLanguages('en', 'en');
  const configureManualModel = async model => {
    await options.bringToFront();
    await options.locator('#auto-generate').uncheck();
    await options.locator('#model').fill(model);
    await options.locator('button[type="submit"]').click();
    await options.waitForFunction(async expected => {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      return response.ok && response.data.model === expected && response.data.autoGenerate === false;
    }, model);
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
      if (await worker.evaluate(() => typeof globalThis.__releaseModel === 'function')) {
        await worker.evaluate(() => { globalThis.__releaseModel(); delete globalThis.__releaseModel; globalThis.__modelFixture.hold = false; });
        return;
      }
      await page.waitForTimeout(100);
    }
    assert.fail('manual generation must reach the held model request');
  };
  const dragHeaderTo = async (x, y) => {
    const heading = await host.locator('.head h2').boundingBox();
    await page.mouse.move(heading.x + 24, heading.y + 12);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();
  };
  await configureManualModel('fixture-manual-success');
  await page.evaluate(() => {
    document.body.style.minHeight = '2400px';
    const result = document.createElement('div');
    result.className = 'gs_r gs_or gs_scl';
    result.innerHTML = '<h3 class="gs_rt"><a href="https://example.org/long-abstract">Long abstract measurement study</a></h3><div class="gs_a">A Smith, B Chen - Measurement Research, 2024 - example.org</div><div class="gs_rs">A long offline abstract for scroll, drag and manual generation checks.</div>';
    document.querySelector('main').append(result);
  });
  const longTitle = page.getByRole('link', { name: 'Long abstract measurement study', exact: true });
  const beforeManual = await generations();
  await longTitle.hover();
  await host.locator('[data-action="generate"]').waitFor();
  check('manual mode does not issue a model request on hover', await generations() === beforeManual);
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
  await worker.evaluate(() => { globalThis.__modelFixture = { hold: true, fail: false }; });
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

  // Unpin first so a drag must establish its own pinned state.
  await host.locator('[data-action="pin"]').click();
  check('pin button click toggles without moving the card', await host.locator('[data-action="pin"]').getAttribute('aria-pressed') === 'false' && Math.abs((await cardBounds()).x - duringGeneratePosition.x) < 1 && Math.abs((await cardBounds()).y - duringGeneratePosition.y) < 1);
  const headingBeforeDrag = await host.locator('.head h2').boundingBox();
  const beforeDrag = await cardBounds();
  await dragHeaderTo(headingBeforeDrag.x - 196, headingBeforeDrag.y - 128);
  const afterDrag = await cardBounds();
  check('header drag moves and pins the card', beforeDrag.x - afterDrag.x > 100 && beforeDrag.y - afterDrag.y > 80 && await host.locator('[data-action="pin"]').getAttribute('aria-pressed') === 'true');
  await page.locator('.gs_rt a').nth(1).hover();
  await page.waitForTimeout(650);
  check('dragged card remains pinned while another result is hovered', await host.getByRole('heading').textContent() === 'Long abstract measurement study');
  await dragHeaderTo(-300, -300);
  check('drag clamps card to the upper-left viewport edge', await withinViewport() && (await cardBounds()).x <= 16 && (await cardBounds()).y <= 16);
  const upperBounds = await cardBounds();
  const upperHeading = await host.locator('.head h2').boundingBox();
  await dragHeaderTo(upperHeading.x + 24, upperHeading.y + 152);
  const returnedBounds = await cardBounds();
  check('card can move down again after being dragged upward', returnedBounds.y - upperBounds.y > 80 && Math.abs(returnedBounds.height - upperBounds.height) < 2 && await withinViewport());
  await dragHeaderTo(1550, 1200);
  check('drag clamps card to the lower-right viewport edge', await withinViewport() && await visibleWithinCard(host.locator('[data-action="close"]')));
  await page.screenshot({ path: path.join(results, 'dragged-card.png'), fullPage: false });
  await host.locator('[data-action="close"]').click();
  await host.waitFor({ state: 'hidden' });
  check('close button closes the dragged card', !await host.isVisible());

  await configureManualModel('fixture-manual-retry');
  await worker.evaluate(() => { globalThis.__modelFixture = { hold: false, fail: true }; });
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
  await worker.evaluate(() => { globalThis.__modelFixture = { hold: true, fail: false }; });
  await host.locator('[data-action="generate"]').click();
  await host.locator('.status').filter({ hasText: 'Generating English text…' }).waitFor();
  await releaseModel();
  await host.locator('.status').filter({ hasText: 'English text generated.' }).waitFor();
  check('explicit retry succeeds with exactly one further request', await generations() === beforeFailure + 2 && (await host.locator('details').textContent()).includes('TRANSLATION_END'));

  check('no unhandled page errors', workerErrors.length === 0);
  const requestLog = await worker.evaluate(() => globalThis.__requests);
  check('no secret in page DOM', !await page.evaluate(() => document.documentElement.outerHTML.includes('TEST_ONLY_SECRET_NOT_REAL')));
  check('requests limited to configured providers', requestLog.every(r => ['api.openalex.org', 'model.test'].includes(r.host)));
  const timings = await worker.evaluate(async () => { const data = await chrome.storage.session.get(['lastModelTiming', 'paperRegistry']); return { model: data.lastModelTiming, metadata: data.paperRegistry?.map(e => e.resolution.timings).filter(Boolean) }; });
  check('provider round-trip diagnostics recorded locally', typeof timings.model?.durationMs === 'number' && timings.metadata.some(t => typeof t.openalex === 'number'));
  await writeFile(path.join(results, 'e2e.json'), JSON.stringify({ passed: checks, count: checks.length, timestamp: new Date().toISOString(), scope: 'Packaged MV3 extension with network and permission-boundary doubles; no real Scholar or paid model calls.', cachedFirstFrame: { count: sorted.length, p95Ms: p95, samplesMs: latencies }, timings, errors: workerErrors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, p95Ms: p95, screenshots: ['test-results/options.png', 'test-results/hover-card.png', 'test-results/options-fr.png', 'test-results/options-de.png', 'test-results/hover-card-fr-de.png', 'test-results/manual-generation-pending.png', 'test-results/long-abstract-bottom.png', 'test-results/dragged-card.png', 'test-results/manual-generation-failed.png'] }));
} catch (error) {
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
    await writeFile(path.join(results, 'e2e-failure.json'), JSON.stringify({ completedChecks: checks, message: String(error), card }, null, 2));
  }
  throw error;
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
