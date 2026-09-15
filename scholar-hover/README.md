# Scholar Hover · 知阅

A desktop Chrome extension that helps you inspect a Google Scholar result before opening the paper. Bring your own model API key; no product account or project-operated backend is required. Version 0.2.0 supports Simplified Chinese, English, French and German.

[简体中文说明](README.zh-CN.md)

**This is an installable prototype, not a publicly released or human-validated product.** Real Scholar matching, translation quality and user value still require trials. Public GitHub publication is explicitly pending the user's confirmation after trying the extension. Human review, including review by native speakers of the supported languages, remains pending. See the [multilingual test report](docs/test-report-multilingual.md) for this version and the [legacy 0.1.0 report](docs/test-report.md) for earlier evidence; neither offline fixtures nor metadata-derived inputs establish real Scholar accuracy.

## Install and configure

1. Extract `release/scholar-hover-0.2.0.zip` into a permanent folder. A source build can also be loaded directly from `dist`.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked**, then select the extracted folder containing `manifest.json`, or the built `dist` folder.
4. Open settings from the extension icon. Choose the interface and output languages, enter the model API base URL, API model identifier and API key, read the external data notice, give consent and save. Chrome requests access to the specific model service domain when you save.
5. Open or refresh a paper results page at `https://scholar.google.com/scholar`. Hover over a title for about 500 ms. Pages already open before installation need a refresh.

Use the provider's versioned **base URL**, such as `https://api.example.com/v1`; the extension appends `/chat/completions`. Do not enter the full completion URL. Use the provider's API model identifier, not a marketing name. Only plain-text, non-streaming Chat Completions are supported; compatibility with every provider is not guaranteed. The connection test sends one short model request and may incur a charge.

When upgrading an unpacked extension, replace its files in the same fixed directory, click Reload on the extensions page, then refresh Scholar. Loading a different directory may create a separate extension instance that needs configuration again. Version 0.1.0 settings remain compatible, but the old generated-text cache is invalidated; new generation may incur model charges. The existing 0.1.0 ZIP is retained for comparison.

## Languages and daily use

Interface language and output language are independent: for example, you can use French controls and generate German translations. Both default to Simplified Chinese, including when upgrading settings without language fields. An unsupported saved language also falls back to Simplified Chinese. A language-only settings change retains your existing keys.

Changing the interface language keeps reusable generated results. Changing the output language uses a separate cache entry: an English result cannot satisfy a request for a German translation. Source titles, source abstracts and bibliographic metadata remain as received. The translated title, abstract and one-sentence summary use the selected output language; changing that setting does not translate the original source text in place.

- Hovering first shows available page information, followed by indexed metadata and then model output. Initial completion time depends on the network and providers; immediate generation is not promised.
- The card appears near the title on narrow screens and beside the results when space allows. Pin it, copy information or open the source page. Keyboard focus also triggers the card; Esc closes it.
- Ambiguous matches require candidate confirmation. An explicit preprint is not silently replaced by a published version. If identity cannot be confirmed, the original page information is retained. Without an abstract, only the title can be translated; no abstract or summary is invented.
- Disable automatic generation to request output by clicking. Failures require a manual retry; the extension does not repeatedly retry model requests on its own.
- Keys stay in browser session storage by default and must be entered again after a browser restart. Optional local persistence is not a system password vault. Changing the model service origin clears the previous model key and requires a new one. The OpenAlex key is never sent to the model service.
- Generated results are limited to 200 entries, seven days and 4 MiB. Paper content, endpoint, model, output language and prompt version affect the cache fingerprint. Different models or output languages occupy separate entries. The cache does not sync between users; settings provide controls to clear the cache and keys.

## Data and limits

Metadata primarily comes from [OpenAlex](https://help.openalex.org/api/). [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) can supplement a missing abstract for the same DOI. The extension records sources; the model cannot change source attribution. The extension accepts an optional OpenAlex key. Availability and limits depend on the provider; wait or use your own permitted quota when rate-limited.

The extension enhances the Scholar results you are viewing. It does not automate searching, pagination or full-text downloading. Read the privacy notice in [English](docs/privacy.en.md), [简体中文](docs/privacy.md), [Français](docs/privacy.fr.md) or [Deutsch](docs/privacy.de.md). The manifest's `optional_host_permissions: ["https://*/*"]` allows requests for custom model domains. Saving requests access to the specific configured domain; installation does not grant access to every website.

This version has no JIF, PDF reading workflow, library synchronization, additional search websites, billing system or automatic telemetry. JIF would require data rights suitable for a public product before integration. A journal metric cannot stand in for assessing an individual paper.

## Development and reproducible checks

Use Node.js 22 or a later supported version and the npm lockfile. Dependency and browser installation need network access; the tests below use local fixtures once their dependencies are available.

```sh
npm ci
npm test
npm run test:corpus
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
npm run package
```

The E2E script loads the real `dist` extension in a temporary, isolated Chromium profile, with offline Scholar pages and API response fixtures. It does not call live Scholar or paid models. Permission grant and denial logic has automated coverage; browser tests use a controlled permission boundary and do not validate Chrome's real authorization dialog. Screenshots and timings are written to `test-results`. Rebuild after source changes before running E2E. Current results and their limits are recorded in the [multilingual test report](docs/test-report-multilingual.md).

Packaging creates an unpackable ZIP and SHA-256 checksum; it does not sign the extension or upload it to a store. A [store listing draft](docs/store-listing.md) exists. Publication still requires review of trial results and release materials; public GitHub publication awaits explicit confirmation after the user trial.

## Human evaluation

The [fixed corpus of 100 real papers](evaluation/corpus-100.json) retains sources and collection timestamps. Its Scholar inputs were derived from metadata; **they are not human ground truth observed on Scholar**. Follow the [evaluation instructions](evaluation/README.md) to record actual inputs, two reviewers' decisions, and translation checks for numbers, negation and strength of claims. The corpus does not demonstrate human review or native-speaker translation coverage in any of the four languages.

```sh
node scripts/collect-corpus.mjs
node scripts/evaluate-corpus.mjs
node scripts/evaluate-corpus.mjs --require-human-review
```

The collection command checks existing files by default; only an explicit `--refresh` collects data from the network again. Without completed human review, the evaluator reports `NOT VALIDATED`, and strict mode exits with code 2. The target is at least 80 correct automatic matches and zero incorrect automatic matches among 100 papers; abstract coverage is reported separately. These targets are not achieved results.

Code is available under the [MIT license](../LICENSE). Third-party services and data retain their own terms.
