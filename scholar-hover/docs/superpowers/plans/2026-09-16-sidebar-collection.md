# Right-side preview and research collection implementation plan

> For agentic workers: use subagent-driven-development for the independent units below and verify integration before release.

**Goal:** Fulfil the user's specified right-side resizable preview, save-paper collection, ordered Markdown export and numbered full-text downloads.

**Architecture:** The content script renders a 420 px fixed right-side panel with full viewport height by default and top/bottom resize handles. The trusted background owns durable saved-paper snapshots, ordering revisions and download state. A dedicated collection.html extension page manages order/removal and starts an export snapshot. Metadata, translations and download links come from the worker registry/cache, never arbitrary web messages.

**Tech Stack:** Existing TypeScript/Vite/MV3, Chrome local storage/downloads, Vitest and isolated Playwright extension fixtures. No new dependency or backend.

**Spec:** User message of 2026-09-16 and these concrete defaults: APA-style metadata citation + BibTeX, one durable current collection, explicit clear for a new search, save order preserved on duplicate updates, user-arranged order controls final 1/2/3 numbering in both Markdown and PDF names. No fabricated citation fields. No automatic login or CAPTCHA bypass: Chrome downloads can use existing site cookies; a failed or unavailable PDF opens the source page for user authentication and offers explicit retry.

## Global constraints

- Retain zh-CN/en/fr/de interface and output support; old settings remain compatible.
- Saving is independent of generation/cache TTL; store source and available generated text, update already-saved text on successful generation.
- At most 200 saved records/4 MiB; explicit capacity error, never silent eviction. Collection mutations serialized, revisions reject stale reorders/removals.
- Preserve original sources, missing-abstract labels, uncertain-match status, generated language/model and timestamps.
- Default panel width 420 px, constrained to viewport on narrow screens; default height 100vh. Top/bottom edges resize vertically with minimum useful height, full-height reset control. Keep pin/Esc/content wheel behavior.
- Download only a known PDF for the matched publication version; don't silently substitute an OA preprint. Otherwise show unavailable and open the source page.
- Chrome downloads permission is for user-triggered exports. Monitor completion/interruption, reject HTML/login responses as full text, preserve numbering and a stable batch snapshot during reordering.
- Public GitHub remains pending the user's explicit confirmation.

## Tasks and interfaces

### 1. Panel and save entry points
Files: src/content/index.ts, src/content/messages.ts, tests/content.test.ts.
- [x] Replace floating positioning/drag with right-docked panel and edge resize; add full-height reset.
- [x] Add SAVE_PAPER {paperId} => SavedPaper and OPEN_COLLECTION commands, localized pending/success/error feedback; pin during saving.
- [x] Regression tests for default placement, resize/clamp, content scroll, old async guards and saving exactly once.

### 2. Collection persistence and export formatting
Files: src/background/collection.ts, src/shared/export.ts, tests/collection.test.ts, tests/export.test.ts.
- [x] createCollectionStore({read(): Promise<unknown>, write(CollectionSnapshot): Promise<void>}) exposing list(), save(Paper, Generated?), updateGenerated(Paper, Generated), remove(id, revision), reorder(ids, revision), clear(revision).
- [x] buildMarkdown(SavedPaper[], Language): string and paperFilename(Paper, number): string; APA-style citation and BibTeX from available fields, escaped Markdown/BibTeX, sanitized numbered filenames.
- [x] First add failing tests for duplicate order, concurrency/stale revisions, capacity/retention and text/filename injection/missing fields; implement and verify.

### 3. Collection management page
Files: collection.html, src/collection/index.ts, src/collection/messages.ts, tests/collection-page.test.ts.
- [x] Read GET_SETTINGS, GET_COLLECTION and GET_EXPORT. Four-language accessible list, remove, drag reorder plus keyboard move controls, clear with confirmation, export button.
- [x] EXPORT_COLLECTION {revision} => ExportBatch, GET_EXPORT => ExportBatch|undefined, RETRY_DOWNLOAD {batchId,itemId} => ExportBatch. Show real download states, source/auth links and failure reasons. Freeze controls while starting mutation, refresh after stale revision.
- [x] Safe text rendering and read-only Markdown preview matching current ordered items. Preserve user state on background refresh.

### 4. Worker integration and full-text downloads
Files: src/shared/types.ts, src/background/router.ts, src/background/index.ts, src/background/downloads.ts, src/background/metadata.ts, src/shared/errors.ts, scripts/build.mjs, manifest.json, tests/router.test.ts, tests/downloads.test.ts, tests/metadata.test.ts.
- [x] Allow collection management only from exact collection.html; Scholar may save its own registered paper and open manager. Generated snapshot is read in worker.
- [x] Keep primary-location PDF/version metadata. Reject invalid URLs and avoid version substitution.
- [x] Persist latest immutable export job. Export Markdown then numbered PDFs via Chrome downloads; record actual terminal states, open source/auth page on failures, provide retry, and recover via GET_EXPORT after worker restart.
- [x] Tests for sender isolation, unknown IDs, failed HTML downloads, unavailable PDF, interrupted transfer, batch numbering, restart and explicit retry.

### 5. Integrated verification and delivery
Files: scripts/e2e.mjs or scripts/e2e-collection.mjs, package/manifest version, README files, privacy notices and docs/test-report-0.3.0.md.
- [x] Offline real extension browser test: full-height panel/resizing/scroll, save duplicate + translated entry, manager deletion/reordering, downloaded Markdown contents and numbered PDF filenames, failure/auth page + retry.
- [x] Run typecheck, full unit suite, evaluator gate, production build and browser regressions. Inspect screenshots and downloaded files.
- [x] Build 0.3.0 ZIP, verify contents/checksum, record limitations accurately, commit locally and deliver update instructions.
