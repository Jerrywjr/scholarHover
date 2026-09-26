# Scholar Hover · 知阅

A desktop Chrome extension that previews links on supported HTTPS websites, including Google Scholar, Nature and arXiv. Bring your own model API key; no product account or project-operated backend is required. The local 0.5.0 working version adds an OFF-by-default toolbar switch, supports Simplified Chinese, English, French and German, keeps a local preview archive and completes explicitly saved papers in the background.

[简体中文说明](README.zh-CN.md)

**Version 0.5.0 is a local experimental version and has not been published.** The public download remains version 0.4.0. Install it manually from [GitHub Releases](https://github.com/Jerrywjr/scholar-hover/releases/tag/v0.4.0); it has not been submitted to or published in the Chrome Web Store. Real Scholar matching, translation quality and usefulness still need human evaluation, including native-speaker review of the four languages. The [0.4.0 test report](docs/test-report-0.4.0.md) describes the automated checks and their limits. Offline fixtures and metadata-derived inputs do not establish real Scholar accuracy.

## Install and configure

1. To try local 0.5.0, build this checkout and load `dist`, or extract the locally provided `scholar-hover-0.5.0.zip`. For the published version, download [scholar-hover-0.4.0.zip](https://github.com/Jerrywjr/scholar-hover/releases/download/v0.4.0/scholar-hover-0.4.0.zip) from the [v0.4.0 release](https://github.com/Jerrywjr/scholar-hover/releases/tag/v0.4.0) and extract it into a permanent folder. Use the extension ZIP, rather than GitHub's automatically generated source-code ZIP. A source build can also be loaded directly from `dist`.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked**, then select the extracted folder containing `manifest.json`, or the built `dist` folder.
4. Open the toolbar popup from the extension icon and choose **Settings**. Choose the interface and output languages, enter the model API base URL, API model identifier and API key, read the external data notice, give consent and save. Chrome requests that model domain if it is not already covered by granted HTTPS access; model consent is still required.
5. In local 0.5.0, return to the toolbar popup and turn previews **ON**. Grant optional `https://*/*` access to all HTTPS websites, then hover over or focus a link for 500 ms on a supported page. Already-open supported pages receive the script without a refresh. The public 0.4.0 download remains Scholar-only.

Use the provider's versioned **base URL**, such as `https://api.example.com/v1`; the extension appends `/chat/completions`. Do not enter the full completion URL. Use the provider's API model identifier, not a marketing name. Only plain-text, non-streaming Chat Completions are supported; compatibility with every provider is not guaranteed. The connection test sends one short model request and may incur a charge.

The published 0.4.0 release also provides a [SHA-256 checksum](https://github.com/Jerrywjr/scholar-hover/releases/download/v0.4.0/scholar-hover-0.4.0.zip.sha256) for the extension ZIP.

When upgrading an unpacked extension, replace its files in the same fixed directory, click Reload on the extensions page, then enable previews in the local 0.5.0 toolbar popup. Refresh Scholar when using the published 0.4.0. Loading a different directory may create a separate extension instance that needs configuration again. Version 0.4.0 migrates the existing generated-text cache into the local IndexedDB archive and removes the old copies only after the archive transaction commits. Migration failure retains the original records. Existing settings and saved papers are retained; generated text is reusable only when its content and configuration fingerprint matches.

Local 0.5.0 starts **OFF** on first installation or when first upgrading from 0.4.x. Later reloads and browser restarts retain your switch setting. The toolbar’s ON action requests optional access to **all HTTPS websites** (`https://*/*`), rather than only one publisher, so it can read hovered-link text and retrieve metadata from the destination. OFF stops new hover previews and keeps the archive and saved papers; jobs already requested may finish. Browser-internal pages (`chrome://`), the Chrome Web Store, native PDF viewers and pages restricting extensions are unsupported. Model use still requires the existing configuration and consent.

## Languages and daily use

Interface language and output language are independent: for example, you can use French controls and generate German translations. Both default to Simplified Chinese, including when upgrading settings without language fields. An unsupported saved language also falls back to Simplified Chinese. A language-only settings change retains your existing keys.

Changing the interface language keeps reusable generated results. Changing the output language uses a separate cache entry: an English result cannot satisfy a request for a German translation. Source titles, source abstracts and bibliographic metadata remain as received. The translated title, abstract and one-sentence summary use the selected output language; changing that setting does not translate the original source text in place.

- Hovering checks the local archive first. Compatible archived metadata and translations appear together. The archive uses the exact normalized destination URL, so another label for the same URL can restore the preview. For a new paper, the card reads the actual destination link before considering index metadata, and displays source information and model output as they become available. Initial completion time depends on the network and providers; immediate generation is not promised. Viewed/saved badges are read locally for the current results page without querying external services for every result.
- The preview is docked to the right at 420 px wide, constrained on narrow windows, and fills the visible browser height by default. Drag its top or bottom edge to resize vertically, or reset to full height. Scroll the content with a wheel, trackpad or keyboard. The panel stays open while crossing the page; outside click, Close or Esc dismiss it when unpinned. Pinning keeps the current paper while other titles are hovered.
- Ambiguous matches require candidate confirmation. An explicit preprint is not silently replaced by a published version. If identity cannot be confirmed, the original page information is retained. Without an abstract, only the title can be translated; no abstract or summary is invented.
- Disable automatic generation to request output by clicking. A manual request pins the card and disables the button while it displays generation progress. Results appear when ready; progress and specific errors stay in the footer. Failures enable an explicit retry button, and Settings remains available. Connection tests time out after 25 seconds; full generation allows up to 90 seconds for the response to start and 90 seconds for the response body to finish. Failures do not retry automatically. If the pointer leaves a paper before metadata or cache lookup completes, the extension defers a new automatic model request until the reader returns to its card.
- Keys stay in browser session storage by default and must be entered again after a browser restart. Optional local persistence is not a system password vault. Changing the model service origin clears the previous model key and requires a new one. The OpenAlex key is never sent to the model service.
- Preview metadata, candidates and generated results are archived locally in IndexedDB. The archive has no extension-imposed expiry or automatic eviction at 200 entries / 4 MiB; browser storage quotas still apply. Paper content, endpoint, model, output language and prompt version affect whether generated text can be reused. Different models or output languages occupy separate entries. The archive does not sync between users; settings provide controls to clear the preview/generation archive and keys.

**Read abstract again** retries source retrieval, while **Retry generation** retries the model against the current paper text. Old unconfirmed previews with no abstract or candidates, including stored HTTP 429 failures, can enter the new retrieval path on reopening; this does not clear complete cached abstracts or paid translations. A newly obtained abstract changes the translation input, so an old title-only translation cannot satisfy it. Saved failures remain available for explicit completion retry. Model calls after successful retrieval still follow your generation setting, consent and configuration.

## Save, organize and export

1. Choose **Save paper** as soon as the preview opens. The visible paper information is saved locally first, without waiting for metadata or model output; successful saving then queues background matching, abstract lookup and generation. Saving is an explicit request to complete that paper even when automatic hover generation is disabled. Model calls still require existing consent, a configured service, domain permission and a valid key, and may incur charges. Available results are reused. Saving the same result again preserves its first-save order and does not restart a failed or interrupted task.
2. **Download saved papers** opens the collection manager. It shows completion progress, configuration or failure details, and matching candidates that require your confirmation. Use **Retry completion** after resolving a failure or missing configuration; model failures never retry automatically. Remove entries, drag to reorder or use the accessible up/down controls. The initial order is save order; final export numbers follow the arranged order.
3. Export Markdown and originals to a new `ScholarHover/time-batch/` folder under browser downloads. `articles.md` contains all papers, original and translated abstracts, key points, provenance, metadata-based APA-style citations and BibTeX. Known PDFs are attempted as `1-Title.pdf`, `2-Title.pdf`, etc. Incomplete papers can be exported: the manager warns that completion is unfinished and missing fields remain marked. Export snapshots keep Markdown and PDF numbering consistent; subsequent completion does not update files already exported.
4. Per-file status distinguishes queued, downloading, complete and failed. Missing PDFs, login HTML and interrupted transfers are reported. The first failed source page opens automatically; other failures have source/authentication links. Complete authentication yourself and explicitly retry. The extension does not sign in or bypass CAPTCHA. When no direct PDF is known, download manually from the article page. Only the matched primary publication version is used; an OA preprint is not silently substituted.

Completion continues after the page tab closes while the browser is running. After a browser or background-worker restart, queued jobs and unfinished metadata lookups resume. A job that had already entered model generation reuses a matching saved result when one exists; otherwise it is marked **Interrupted** and requires a manual retry because the previous request may already have been charged. Session-only keys must be entered again after a browser restart. Deleting a saved entry prevents its old completion job from recreating it or overwriting a later re-save.

The separate local collection holds up to 200 papers / 4 MiB without expiry; this limit does not apply to the preview/generation archive. Clear and start a new search requires confirmation; clearing the archive leaves saved papers intact. Deleting saved papers does not remove exported files. Citations preserve available author metadata and omit unavailable volume/issue/pages; generic BibTeX `misc` entries need checking before formal use. The `downloads` permission is used for explicitly requested exports and monitoring those transfers.

## Data and limits

After the local archive, the hovered destination is read for verifiable scholarly metadata. arXiv `/abs/`, `/pdf/` and `/html/` links are normalized to an abstract page and retain an explicit revision such as `v2`; a manuscript is not replaced by an indexed publication or another revision. Nature extraction requires verified article identity and an explicit Abstract section. Other public HTML pages need citation metadata or `ScholarlyArticle` structured data identifying the paper and an explicit abstract. Generic descriptions and search snippets are not full abstracts. A generic link without scholarly metadata never triggers an index title search from its label: it can be saved immediately, and a manual click can translate only that title, without inventing an abstract. For identified papers, [OpenAlex](https://help.openalex.org/api/) and [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) may supplement missing metadata or an abstract under identity checks. arXiv revisions are not replaced. The extension records sources; the model cannot change source attribution. Provider availability and rate limits still apply. This parser support does not establish broad publisher coverage.

The extension enhances links on supported HTTPS pages after the toolbar’s explicit ON action grants optional `https://*/*` access to all HTTPS websites. It does not automate searches or pagination. Full-text downloads start only when explicitly exporting from the collection manager. Read the privacy notice in [English](docs/privacy.en.md), [简体中文](docs/privacy.md), [Français](docs/privacy.fr.md) or [Deutsch](docs/privacy.de.md). Installation does not itself grant all-website access; enabling previews does. Source HTML is fetched without cookies, login credentials or API keys and parsed locally in the offscreen page. Keys never enter web pages, and full pages never go to models; only the title, actual available abstract and instructions are sent after existing model consent. Source scripts, login flows and redirects are not executed; arbitrary PDF text is not extracted. Explicit PDF exports remain unchanged, and Chrome may send the source site’s existing cookies for those downloads.

This version has no JIF, PDF reading workflow, library synchronization, billing system or automatic telemetry. JIF would require data rights suitable for a public product before integration. A journal metric cannot stand in for assessing an individual paper.

## Development and reproducible checks

Use Node.js 22 or a later supported version and the npm lockfile. Run these commands from the repository's `scholar-hover/` directory. Dependency and browser installation need network access; the tests below use local fixtures once their dependencies are available.

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

The E2E script loads the real `dist` extension in a temporary, isolated Chromium profile, with offline Scholar and generic HTTPS pages and API response fixtures. It does not call live Scholar or paid models. Permission grant and denial logic has automated coverage; browser tests pre-grant HTTPS access at a controlled permission boundary and do not validate Chrome's native authorization dialog. Current verification is recorded in the [0.5.0 report](docs/test-report-0.5.0.md). Screenshots and timings are written to `test-results`. Rebuild after source changes before running E2E. Historical 0.4.0 checks and their limits are recorded in the [0.4.0 report](docs/test-report-0.4.0.md).

Packaging creates an unpackable ZIP and SHA-256 checksum; it does not sign the extension or upload it to a store. The [store listing](docs/store-listing.md) remains a draft. See [release status and remaining checks](docs/release-readiness.md) for the distinction between the GitHub experiment, store submission and human evaluation.

## Report a problem

Use [GitHub Issues](https://github.com/Jerrywjr/scholar-hover/issues) for bugs and feature requests. Include the extension and Chrome versions, steps to reproduce, expected and actual behavior, and a public paper link or DOI when it helps. For model failures, include the provider and API model name without credentials. Remove API keys, login details and private content from screenshots or logs before posting; issues are public.

Code and documentation contributions are welcome. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the development workflow and language-review guidance.

## Human evaluation

The [fixed corpus of 100 real papers](evaluation/corpus-100.json) retains sources and collection timestamps. Its Scholar inputs were derived from metadata; **they are not human ground truth observed on Scholar**. Follow the [evaluation instructions](evaluation/README.md) to record actual inputs, two reviewers' decisions, and translation checks for numbers, negation and strength of claims. The corpus does not demonstrate human review or native-speaker translation coverage in any of the four languages.

```sh
node scripts/collect-corpus.mjs
node scripts/evaluate-corpus.mjs
node scripts/evaluate-corpus.mjs --require-human-review
```

The collection command checks existing files by default; only an explicit `--refresh` collects data from the network again. Without completed human review, the evaluator reports `NOT VALIDATED`, and strict mode exits with code 2. The target is at least 80 correct automatic matches and zero incorrect automatic matches among 100 papers; abstract coverage is reported separately. These targets are not achieved results.

Historical checks are documented in the [0.3.1 slow-model request report](docs/test-report-0.3.1.md), [0.3.0 collection and download report](docs/test-report-0.3.0.md), and [0.2.0 multilingual report](docs/test-report-multilingual.md). Each describes that version, rather than the current release status.

Code is available under the [MIT license](../LICENSE). Third-party services and data retain their own terms.
