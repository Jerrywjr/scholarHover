# Scholar Hover · 知阅

A desktop Chrome extension that helps you inspect a Google Scholar result before opening the paper. Bring your own model API key; no product account or project-operated backend is required. Version 0.3.1 supports Simplified Chinese, English, French and German.

[简体中文说明](README.zh-CN.md)

**This is an installable prototype, not a publicly released or human-validated product.** Real Scholar matching, translation quality and user value still require trials. Public GitHub publication is explicitly pending the user's confirmation after trying the extension. Human review, including review by native speakers of the supported languages, remains pending. See the [0.3.1 slow-model request report](docs/test-report-0.3.1.md), the [0.3.0 collection and download report](docs/test-report-0.3.0.md), and the [0.2.0 multilingual report](docs/test-report-multilingual.md); neither offline fixtures nor metadata-derived inputs establish real Scholar accuracy.

## Install and configure

1. Extract `release/scholar-hover-0.3.1.zip` into a permanent folder. A source build can also be loaded directly from `dist`.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked**, then select the extracted folder containing `manifest.json`, or the built `dist` folder.
4. Open settings from the extension icon. Choose the interface and output languages, enter the model API base URL, API model identifier and API key, read the external data notice, give consent and save. Chrome requests access to the specific model service domain when you save.
5. Open or refresh a paper results page at `https://scholar.google.com/scholar`. Hover over a title for about 500 ms. Pages already open before installation need a refresh.

Use the provider's versioned **base URL**, such as `https://api.example.com/v1`; the extension appends `/chat/completions`. Do not enter the full completion URL. Use the provider's API model identifier, not a marketing name. Only plain-text, non-streaming Chat Completions are supported; compatibility with every provider is not guaranteed. The connection test sends one short model request and may incur a charge.

When upgrading an unpacked extension, replace its files in the same fixed directory, click Reload on the extensions page, then refresh Scholar. Loading a different directory may create a separate extension instance that needs configuration again. Version 0.1.0 settings remain compatible, but the old generated-text cache is invalidated; new generation may incur model charges. Upgrading from 0.2.0 does not deliberately clear configuration or generated-text caches. Earlier ZIP files are retained for comparison.

## Languages and daily use

Interface language and output language are independent: for example, you can use French controls and generate German translations. Both default to Simplified Chinese, including when upgrading settings without language fields. An unsupported saved language also falls back to Simplified Chinese. A language-only settings change retains your existing keys.

Changing the interface language keeps reusable generated results. Changing the output language uses a separate cache entry: an English result cannot satisfy a request for a German translation. Source titles, source abstracts and bibliographic metadata remain as received. The translated title, abstract and one-sentence summary use the selected output language; changing that setting does not translate the original source text in place.

- Hovering first shows available page information, followed by indexed metadata and then model output. Initial completion time depends on the network and providers; immediate generation is not promised.
- The preview is docked to the right at 420 px wide, constrained on narrow windows, and fills the visible browser height by default. Drag its top or bottom edge to resize vertically, or reset to full height. Scroll the content with a wheel, trackpad or keyboard. The panel stays open while crossing the page; outside click, Close or Esc dismiss it when unpinned. Pinning keeps the current paper while other titles are hovered.
- Ambiguous matches require candidate confirmation. An explicit preprint is not silently replaced by a published version. If identity cannot be confirmed, the original page information is retained. Without an abstract, only the title can be translated; no abstract or summary is invented.
- Disable automatic generation to request output by clicking. A manual request pins the card and disables the button while it displays generation progress. Results appear when ready; progress and specific errors stay in the footer. Failures enable an explicit retry button, and Settings remains available. Connection tests time out after 25 seconds; full generation allows up to 90 seconds for the response to start and 90 seconds for the response body to finish. Failures do not retry automatically. If the pointer leaves a paper before metadata or cache lookup completes, the extension defers a new automatic model request until the reader returns to its card.
- Keys stay in browser session storage by default and must be entered again after a browser restart. Optional local persistence is not a system password vault. Changing the model service origin clears the previous model key and requires a new one. The OpenAlex key is never sent to the model service.
- Generated results are limited to 200 entries, seven days and 4 MiB. Paper content, endpoint, model, output language and prompt version affect the cache fingerprint. Different models or output languages occupy separate entries. The cache does not sync between users; settings provide controls to clear the cache and keys.

## Save, organize and export

1. Choose **Save paper** in a preview. This stores source metadata, the original abstract and available translations without an extra model request. Saving again updates the same entry without changing its first-save order. Later successful generation updates a saved paper only when its source content still matches.
2. **Download saved papers** opens the collection manager. Remove entries, drag to reorder or use the accessible up/down controls. The initial order is save order; final export numbers follow the arranged order.
3. Export Markdown and originals to a new `ScholarHover/time-batch/` folder under browser downloads. `articles.md` contains all papers, original and translated abstracts, key points, provenance, metadata-based APA-style citations and BibTeX. Known PDFs are attempted as `1-Title.pdf`, `2-Title.pdf`, etc. Export snapshots keep Markdown and PDF numbering consistent even if the collection changes later.
4. Per-file status distinguishes queued, downloading, complete and failed. Missing PDFs, login HTML and interrupted transfers are reported. The first failed source page opens automatically; other failures have source/authentication links. Complete authentication yourself and explicitly retry. The extension does not sign in or bypass CAPTCHA. When no direct PDF is known, download manually from the article page. Only the matched primary publication version is used; an OA preprint is not silently substituted.

The separate local collection holds up to 200 papers / 4 MiB without expiry. Clear and start a new search requires confirmation; clearing the generation cache leaves saved papers intact. Deleting saved papers does not remove exported files. Citations preserve available author metadata and omit unavailable volume/issue/pages; generic BibTeX `misc` entries need checking before formal use. Version 0.3.0 adds the `downloads` permission for explicitly requested exports and monitoring those transfers.

## Data and limits

Metadata primarily comes from [OpenAlex](https://help.openalex.org/api/). [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) can supplement a missing abstract for the same DOI. The extension records sources; the model cannot change source attribution. The extension accepts an optional OpenAlex key. Availability and limits depend on the provider; wait or use your own permitted quota when rate-limited.

The extension enhances the Scholar results you are viewing. It does not automate searching or pagination. Full-text downloads start only when explicitly exporting from the collection manager. Read the privacy notice in [English](docs/privacy.en.md), [简体中文](docs/privacy.md), [Français](docs/privacy.fr.md) or [Deutsch](docs/privacy.de.md). The manifest's `optional_host_permissions: ["https://*/*"]` allows requests for custom model domains. Saving requests access to the specific configured domain; installation does not grant access to every website.

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

The E2E script loads the real `dist` extension in a temporary, isolated Chromium profile, with offline Scholar pages and API response fixtures. It does not call live Scholar or paid models. Permission grant and denial logic has automated coverage; browser tests use a controlled permission boundary and do not validate Chrome's real authorization dialog. Screenshots and timings are written to `test-results`. Rebuild after source changes before running E2E. Current results and their limits are recorded in the [0.3.0 report](docs/test-report-0.3.0.md).

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
