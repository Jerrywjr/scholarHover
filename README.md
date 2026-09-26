# Scholar Hover · 知阅

**Decide what to read—without opening every paper.**

A Chrome extension that puts source-linked paper previews beside links on supported HTTPS websites, including Google Scholar, Nature and arXiv. Translate a title and actual abstract, keep the result for your next visit, and save papers immediately while the remaining information is completed in the background.

**English** · [简体中文](README.zh-CN.md)

[Download published v0.4.0](https://github.com/Jerrywjr/scholar-hover/releases/tag/v0.4.0) · [Setup guide](scholar-hover/README.md) · [Report a problem](https://github.com/Jerrywjr/scholar-hover/issues) · [MIT license](LICENSE)

**The local working version is 0.5.0, with an OFF-by-default toolbar switch and previews across supported HTTPS websites.** It has not been published to GitHub Releases or the Chrome Web Store. The download above remains the published 0.4.0; build this checkout or use the local 0.5.0 package to try the changes.

Local 0.5.0 passes **468 unit/DOM tests and 139 browser checks** with controlled fixtures. See the [0.5.0 test report](scholar-hover/docs/test-report-0.5.0.md) for evidence and limits. Browser fixtures pre-grant HTTPS access; Chrome’s native permission dialog remains a manual check.

## The problem: screening papers interrupts the search

You search for a topic and find a promising title. To decide whether to read it, you open another tab, locate the abstract, translate it, and copy the useful details somewhere. A few papers later, you return to the same result and repeat the work. If you already know you want to keep a paper, waiting for an AI response just to save it adds another interruption.

Scholar Hover keeps that first decision next to the search result—and keeps the information you have already generated.

| During a literature search | What Scholar Hover does |
| --- | --- |
| “Is this paper worth opening?” | Hover for 500 ms to open the side panel. Available information appears first; retrieved abstracts, translations and abstract-based summaries follow as they become available. |
| “I already translated this one.” | Restore locally archived information, including papers you viewed but never explicitly saved. Matching content and model settings reuse the generated result. |
| “I want this paper. Let me keep searching.” | Save the visible paper information immediately. Matching, abstract lookup and translation continue in the background while the browser stays open. |
| “Now I need a reading list I can use.” | Remove or reorder saved papers, then export one numbered Markdown file with APA-style references and BibTeX. Attempt available PDFs using the same numbering. |

## A search-to-reading-list workflow

1. **Preview.** Open the toolbar popup, turn previews ON and grant optional access to all HTTPS websites (`https://*/*`). Hover over or focus a link for 500 ms on a supported HTTPS page, such as a Scholar result, a Nature article link or an arXiv link. Pin the right-hand panel, scroll the abstract, or drag its top and bottom edges to change its height.
2. **Keep what you learn.** Viewed papers and generated text remain in the local archive until you clear it. Result badges distinguish **Not viewed**, **Viewed** and **Saved**, including after a browser restart.
3. **Save when you decide.** Click **Save paper** without waiting for translation. The saved-papers page shows progress, asks you to confirm ambiguous matches and offers an explicit retry if completion fails.
4. **Take the list with you.** Open **Download saved papers**, arrange the order, and export `articles.md` plus available originals such as `1-Paper title.pdf` and `2-Paper title.pdf`.

![An English paper preview with a Chinese title translation, an abstract-based summary and Save paper controls](docs/images/paper-preview.png)

*Actual extension UI on an offline demonstration page. Papers, metadata and model responses in these screenshots are synthetic test fixtures; they do not represent research findings or a live Scholar evaluation.*

<details>
<summary>See the saved-papers manager</summary>

![Saved papers with completion states, ordering controls and per-file download results](docs/images/reading-list.png)

The manager keeps completion status separate from download status. A paper can be saved successfully even when its full-text PDF requires a publisher login.

</details>

## Install in Chrome

Requires **desktop Chrome 120 or later**. This release is loaded as an unpacked extension; it is not a Chrome Web Store listing.

1. Download [scholar-hover-0.4.0.zip](https://github.com/Jerrywjr/scholar-hover/releases/download/v0.4.0/scholar-hover-0.4.0.zip) from the release and extract it into a permanent folder. A [SHA-256 checksum](https://github.com/Jerrywjr/scholar-hover/releases/download/v0.4.0/scholar-hover-0.4.0.zip.sha256) is included.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
3. In local 0.5.0, open the toolbar popup and choose **Settings**; the published 0.4.0 icon opens settings directly. Choose your interface and output languages, enter your model provider's HTTPS base URL, model name and API key, then review the data-sharing notice and save.
4. For local 0.5.0, return to the toolbar popup, turn **ON** and grant optional access to all HTTPS websites. Hover over or focus a link for 500 ms; supported already-open pages receive the preview script without a refresh. The published 0.4.0 download retains its Scholar-only workflow.

**Bring your own model API key.** Generation uses non-streaming Chat Completions requests; compatibility depends on the provider. For a base URL such as `https://api.example.com/v1`, the extension appends `/chat/completions`. No Scholar Hover account or project-operated backend is required. Metadata previews work without a model key; translations need configuration and consent. Provider charges may apply.

When upgrading, replace the files in the **same extension folder**, reload the extension; in local 0.5.0, enable the toolbar switch again. Refresh Scholar for the published 0.4.0. Avoid uninstalling or loading a different directory if you want to retain the original extension's local data. See the [detailed English guide](scholar-hover/README.md) or [中文配置说明](scholar-hover/README.zh-CN.md).

Local 0.5.0 starts **OFF** on first installation or when first upgrading from 0.4.x. Later reloads and browser restarts retain your switch setting. Enabling in the toolbar popup requests optional `https://*/*` access to all HTTPS websites, allowing hovered-link text and destination metadata to be read. OFF stops new hover previews, keeps saved content and may leave already-requested jobs running. Browser-internal pages such as `chrome://`, the Chrome Web Store, native PDF viewers and pages restricting extensions are unsupported.

## Languages, data and control

- **Four languages:** English, Simplified Chinese, French and German. Interface and generated-content languages are independent. Both default to Simplified Chinese; choose your preference in settings.
- **Traceable metadata:** After checking the archive by the exact normalized destination URL, 0.5.0 reads that destination for verifiable scholarly metadata and an actual abstract. Different labels pointing to the same normalized URL reuse the same preview. arXiv abstract, PDF and HTML links preserve an explicit revision; Nature pages require an explicit Abstract section and verified paper identity. Other public pages need citation metadata or an explicit `ScholarlyArticle` abstract. OpenAlex and Crossref supplement verified paper identities; an arbitrary link label is never searched as a paper title. Without scholarly metadata, generation requires an explicit click and translates only the link title; no abstract is invented. An arXiv manuscript is never replaced by an indexed version.
- **Abstract-based output:** The one-sentence summary is based on the retrieved abstract. Without an abstract, only title translation is allowed. The extension does not infer a paper's methods or results from its title.
- **Local retention:** Previews and translations have no automatic age or count eviction. Browser storage limits still apply. The separate saved reading list holds up to 200 papers / 4 MiB; clearing the preview archive leaves that list intact.
- **Explicit model use:** Automatic hover generation can be disabled. Saving a paper explicitly requests background completion even in manual-hover mode; model calls still require your consent, configuration and permission. Failed completion does not automatically repeat model calls. An interrupted request after restart may need a manual retry and may already have been charged.
- **Keys and privacy:** Full pages are parsed locally and never sent to models; keys are never written into web pages. Keys stay in the browser session by default, with optional local persistence. The model receives the title, available abstract and translation instructions. There is no project telemetry or cross-device sync. Read the privacy notice in [English](scholar-hover/docs/privacy.en.md), [中文](scholar-hover/docs/privacy.md), [Français](scholar-hover/docs/privacy.fr.md) or [Deutsch](scholar-hover/docs/privacy.de.md).

A missing abstract or old metadata HTTP 429 needs **Read abstract again**, which retries retrieval; **Retry generation** retries the model using the text already retrieved. Eligible old previews without an abstract are refreshed through the new path when reopened. Complete cached abstracts and compatible paid translations remain reusable. Source-page requests omit cookies and credentials; HTML is parsed locally without running page scripts or following redirects. This does not extract text from arbitrary PDFs or sign into publisher sites.

## What to expect from this release

**The published v0.4.0 and local v0.5.0 are experimental.** The public download supports Scholar results; local 0.5.0 supports links on permitted HTTPS websites but cannot guarantee metadata or abstracts for every site. Nature and arXiv parsing support is not evidence of broad publisher coverage. Model translations can be wrong. Check important numbers, negation and conclusions against the original text.

PDF downloads depend on accessible source links. Login pages, missing PDFs and interrupted downloads are reported; you complete institutional authentication or CAPTCHA yourself. The extension does not bypass access controls. APA-style references use available metadata and omit missing fields; review them before formal citation.

There is no journal impact factor, PDF analysis, reference-library synchronization or automatic Scholar crawling. The project focuses on the decision before full-text reading.

The local 0.5.0 checks cover cross-site previews, switching, persistent translations, immediate saving, restart recovery, request deduplication and ordered exports. They do not establish faster screening, real-world matching accuracy or translation quality. See the [current verification report](scholar-hover/docs/test-report-0.5.0.md), [historical v0.4.0 report](scholar-hover/docs/test-report-0.4.0.md) and [human evaluation plan](scholar-hover/evaluation/README.md).

## Develop and contribute

The extension is TypeScript + Vite + Chrome Manifest V3. Content scripts render the preview in a Shadow DOM; the background resolves papers and coordinates local storage; an extension-owned worker handles model requests. All source lives in `scholar-hover/`.

```sh
git clone https://github.com/Jerrywjr/scholar-hover.git
cd scholar-hover/scholar-hover
npm ci
npm test
npm run test:corpus
npm run build
```

Load the generated `dist/` directory in Chrome. To run the isolated browser checks and package the extension:

```sh
npx playwright install --with-deps chromium
npm run test:e2e
npm run package
```

Use Node.js 22. Tests need no real model key. Hosted GitHub Actions is not enabled in this initial publication; a [workflow example and setup instructions](docs/ci/README.md) are included. For bugs, include the extension version, reproduction steps and expected behavior in [GitHub Issues](https://github.com/Jerrywjr/scholar-hover/issues)—never API keys or private paper content. Reproducible matching failures, accessibility feedback and language reviews are especially useful. See [CONTRIBUTING.md](CONTRIBUTING.md).

Code is licensed under [MIT](LICENSE). Third-party data and services retain their own terms. Scholar Hover is an independent project, unaffiliated with Google Scholar, OpenAlex or model providers.
