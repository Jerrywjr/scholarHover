# Scholar Hover · Privacy notice

Version 0.4.0 · 2026-09-16

[简体中文](privacy.md) · [Français](privacy.fr.md) · [Deutsch](privacy.de.md)

This extension only enhances search results pages that the user opens at https://scholar.google.com/scholar. It reads titles, authors, years, publication venues and links from the current results page locally to identify papers and display unviewed, viewed and saved badges. It does not send untriggered results to external metadata services in bulk. Only papers whose preview the user activates or that the user explicitly saves are queried through external services under the rules below. It does not automate searching or pagination. Full-text downloads are explicitly started by the user in the collection manager. There is no product account or project-operated server.

## Where data is sent

- OpenAlex receives the DOI or title of a paper whose preview the user activates or that the user explicitly saves, to retrieve metadata and abstracts. If an OpenAlex key is provided, that key is sent only to api.openalex.org.
- Crossref receives the DOI when needed to supplement missing metadata for the same paper.
- The model service configured by the user receives the current paper's title, retrieved abstract and translation instructions for the selected output language only after configuration and consent to external transmission. Without an abstract, only the title and translation instructions are sent; no abstract or summary is generated. The model API key is sent only to the configured HTTPS service address. The provider determines its own data retention rules.
- Automatic mode can call the model after a qualifying hover and may incur charges. Generation can instead require a click. Choosing **Save paper** also requests background completion, even when automatic hover generation is disabled; model calls still require existing consent, a valid key and model-domain permission. Matching saved results are reused. Closing the card or Scholar tab does not cancel completion of saved papers or guarantee cancellation of charges already incurred at the provider.

Interface and output languages can independently be set to Simplified Chinese, English, French or German; both default to Simplified Chinese. Language settings are stored locally. Changing only the interface language reuses the generation cache; different output languages use separate cache entries. Translations do not overwrite the original paper information.

## Local storage

Keys are stored in the extension's browser session storage by default and are cleared when the browser restarts. If local key persistence is selected, keys are saved in local extension storage. This is not a system password vault or a promise of encrypted custody. Keys are not written to web pages, sync storage, analytics or logs, and page content scripts cannot read key storage. Keys can be cleared at any time.

Paper previews, matching candidates and generated results are archived only in local IndexedDB. The extension applies no expiry or automatic eviction at 200 entries / 4 MiB to this archive; browser storage quotas still apply. Different models or output languages use separate records, and reuse requires a matching content and configuration fingerprint. The archive does not sync across devices. Version 0.4.0 migrates existing generated-text caches and removes the old copies only after the archive transaction commits; migration failure retains the originals. Unrecognized old records are retained as raw copies and are not guaranteed to be reusable translations.

**Clear cache** removes preview and generation archives; **Clear keys** handles credentials separately. Saved papers must be removed or cleared from their separate collection. Uninstalling the extension deletes its local storage; browser data clearing or storage failures can also affect the archive, so it is not a backup. These operations cannot delete data already received by a service provider.

## Permissions and controls

The extension runs only on Scholar paper search pages. OpenAlex and Crossref permissions allow metadata access. Access to a custom model domain is requested separately when the user saves configuration. The optional HTTPS domain range in the manifest supports user-defined addresses; installation does not grant access to every website. The `offscreen` permission lets an extension-owned hidden page and dedicated Worker wait for slower model responses. That page does not read website content, and the model key is still sent only to the configured model endpoint.

This version has no ads, automatic telemetry or background uploads of usage records. Test diagnostics are stored locally; inspect them before sharing. Model output may be incorrect. Abstract translations and summaries identify their source basis and cannot substitute for conclusions from the full paper or a paper quality score. Live-page trials, human review including native-speaker review in all four languages, and controlled user evaluation of paper-screening effectiveness remain incomplete.

Version 0.4.0 is an open-source experimental release for public testing: [GitHub project](https://github.com/Jerrywjr/scholar-hover). Report problems and contact the project publicly through [GitHub Issues](https://github.com/Jerrywjr/scholar-hover/issues). Publication on GitHub is separate from publication in the Chrome Web Store; this version has not been submitted to or listed in that store. A future store submission will include a working contact channel and a public URL for this privacy notice on the store page.

## Explicit saving, background completion and export (0.4.0)

**Save paper** first writes the available page information to a separate local collection, then queues matching, abstract lookup and generation using the existing model configuration. The collection is limited to 200 papers and 4 MiB without automatic expiry. Records remain until removed, cleared or the extension is uninstalled. Clearing preview and generation archives does not clear this collection. Saving the same result again preserves its first-save order and does not restart a failed job; later results update only a saved entry that still exists and matches the source content.

Completion continues after the Scholar tab closes while the browser is running. After a browser or background-worker restart, queued jobs and metadata lookups can resume. Jobs that had entered model generation first look for a reusable result; without one they are marked **Interrupted** and require a manual retry because the previous request may have been charged. Failed model requests are not retried automatically. Missing configuration requires user action, and uncertain matches require candidate confirmation. Session-only keys must be entered again after a browser restart.

Export Markdown and originals uses the downloads permission to create a Markdown file and attempt known full-text PDF downloads. Incomplete papers can be exported with a visible warning and marked missing fields. Export captures the current state; later completion does not rewrite exported files. Requests go to the full-text provider and Chrome includes existing cookies for that site; model and OpenAlex keys are never sent there. Full text is not sent to a model for analysis. Failed or unavailable PDFs show a reason; the first failed source page in each batch opens automatically, with links for the others. Users complete sign-in, institutional authentication and CAPTCHA themselves.

The latest batch filenames, source links and transfer states are stored locally for checking and retry. Non-PDF responses are not marked successful; the extension attempts to remove only that invalid file newly created by the batch. Normal exported files remain in the browser download directory after collection deletion, cache clearing or extension removal. Background completion sends paper information only to the metadata and model services described above; it does not upload usage history or telemetry.
