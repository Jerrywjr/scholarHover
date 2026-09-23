# 0.4.1 source-first abstract retrieval — verification

Date: 2026-09-23. This is a local test build, not a published GitHub or Chrome Web Store release.

## Reported failure and evidence

The reported Scholar result linked to **NetConfArena: An Executable Benchmark for LLM Agents in Closed-Loop Network Configuration**, arXiv **2608.23179**. The card showed an HTTP 429 metadata warning, no abstract, and a misleading request to confirm a record despite offering no candidates.

The previous `resolvePaper()` in commit `b11e099` requested OpenAlex first, returned immediately on an HTTP error, and called Crossref only after an OpenAlex match lacked an abstract. It never read the Scholar result's destination URL. The content script's `refreshPreview()` only resolved entries with no cached resolution, so persisted 429 results prevented a new lookup. A model-generation retry could only translate the title already available. These are separate retrieval and cache-flow defects; the screenshot does not establish a model timeout.

The public [arXiv source page](https://arxiv.org/abs/2608.23179) was fetched on 2026-09-23 and passed through the production parser. It yielded the title, four authors, and a 1,590-character abstract containing the reported **480** tasks and **3840** trajectories. The live HTML uses `citation_author="Liu, Chang"`; a regression verifies normalization to `Chang Liu` for comparison with Scholar's `C Liu`. This is direct source-extraction evidence, not a test of translation quality. No real model key or paid model call was used in verification.

## Important functions and responsibilities

| File | Functions | Responsibility |
|---|---|---|
| [metadata.ts](../src/background/metadata.ts) | `resolvePaper`, `resolveIndexedPaper` | Read the linked source first; use conservative index fallback for generic sources. Keep arXiv manuscript revisions separate from indexed works. |
| [source.ts](../src/background/source.ts) | `readSourcePaper` | Check the exact host permission, fetch bounded HTML with a 10-second deadline, omit cookies/keys, reject redirects and non-HTML responses, and invoke local parsing. |
| [source-page.ts](../src/shared/source-page.ts) | `normalizeSourceUrl`, `extractSourcePaper`, `authorName`, `scholarlyArticles` | Normalize arXiv links while retaining versions; extract and verify citation metadata or explicit scholarly abstracts; normalize author order; reject conflicting identities. |
| [offscreen-document.ts](../src/background/offscreen-document.ts), [offscreen/index.ts](../src/offscreen/index.ts) | `ensureOffscreenDocument`, message listener | Share Chrome's single offscreen document between inert HTML parsing and model workers; accept commands only from the extension background. |
| [router.ts](../src/background/router.ts) | `needsSourceRefresh`, `resolve`, `archive`, request handler | Identify eligible old incomplete previews without networking during cache reads, deduplicate retrieval, preserve paid output on failed refresh, and synchronize saved copies. |
| [completion.ts](../src/background/completion.ts) | `createCompletionQueue`, `process`, `resume` | Complete saved papers after closing Scholar, retain an explicit metadata retry across worker recovery, and report a failed abstract refresh while keeping an existing title translation. |
| [content/index.ts](../src/content/index.ts) | `resolutionNotice`, `refreshPreview`, `enrich`, `outputIdentity`, `onWindowFocus` | Separate metadata retry from model retry, migrate old failed previews, prevent stale output after inputs change, and resume retrieval after per-site authorization. |
| [source-access/index.ts](../src/source-access/index.ts) | `startSourceAccessPage` | Request only the displayed website origin from a direct user click. No paper or model requests occur on this page. |
| [source-e2e.mjs](../scripts/source-e2e.mjs) | `installFetchBoundary`, `openScholar`, `completeAbstract`, `waitUntil` | Test the built extension with controlled metadata responses, actual background/offscreen/permission/storage/UI paths, and a local HTTPS model fixture. Temporary profiles, certificates and servers are cleaned in `finally`. |

## Reproduce

From `scholar-hover/`:

```sh
npm test
npm run test:corpus
npm run package
npm run test:source-e2e
npm run test:e2e
```

Unit and DOM verification: **407 tests passed**, with TypeScript checking and the corpus-evaluator subprocess checks passing. The new tests were observed failing before the corresponding fixes.

Both browser suites ran against the final 0.4.1 build: **29 source-flow checks** and **87 existing checks**, all passing. The source suite made five synthetic arXiv requests, one OpenAlex request only in the deliberately unapproved-publisher scenario, no Crossref requests and exactly one local model-fixture call. Returning after a real browser restart made zero additional requests. Saving during a held source request was acknowledged in 42 ms in this run. These timings describe the local fixture and device only.

The installable ZIP contains manifest version 0.4.1, the arXiv host permission, the source-access page and the updated four-language privacy notices. SHA-256: `225e9bfb0932903331a3e96da1cbb04ad8f3e17a8691737959ab6635a6dd88d6`.

## Limits

- Browser scenarios use synthetic paper text and an artificial model response. They verify transport, lifecycle, caching and UI behavior, not the scientific correctness of a translation or general screening effectiveness.
- arXiv pages are read directly; `/pdf/` and `/html/` links become the corresponding abstract page without dropping an explicit `vN`. Complete stored abstracts and translations remain reusable.
- Other publishers require individual host access and recognizable citation metadata or an explicit `ScholarlyArticle` abstract. Login/challenge pages, arbitrary PDF text, script-rendered abstracts and redirected requests are not parsed. Generic descriptions and Scholar snippets are not treated as abstracts.
- HTTP 429, timeouts and website access failures remain possible. The fix removes OpenAlex as a prerequisite for readable arXiv sources; it does not guarantee universal publisher access or unlimited requests.
- The existing 100-paper corpus still requires human review. No new matching-accuracy, translation-quality or user-study claim is made.

## 升级与问题定位

此修复的核心是“先读取搜索结果指向的原文摘要，再调用已配置的模型”，并修复旧 429 缓存阻止重查的问题。安装本地 0.4.1 后，在 Chrome 扩展管理页重新加载，再刷新 Scholar 页面。新增的 arXiv 访问权限可能需要浏览器确认；其他出版网站按具体网站授权。已有完整译文继续保留，重新读取失败也不删除已有标题译文。

“重新读取摘要”用于来源查询；“重试生成”用于模型调用。页面取不到摘要时，仍不得根据标题编造方法、结果或结论。
