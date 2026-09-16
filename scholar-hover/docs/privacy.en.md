# Scholar Hover · Privacy notice

Version 0.3.0 · 2026-09-16

[简体中文](privacy.md) · [Français](privacy.fr.md) · [Deutsch](privacy.de.md)

This extension only enhances search results pages that the user opens at https://scholar.google.com/scholar. It reads the triggered result's title, authors, year, publication venue and links to identify the paper. It does not automate searching or pagination; full-text downloads are explicitly started by the user in the collection manager, and has no product account or project-operated server.

## Where data is sent

- OpenAlex receives the triggered paper's DOI or title to retrieve metadata and abstracts. If an OpenAlex key is provided, that key is sent only to api.openalex.org.
- Crossref receives the DOI when needed to supplement missing metadata for the same paper.
- The model service configured by the user receives the current paper's title, retrieved abstract and translation instructions for the selected output language only after configuration and consent to external transmission. Without an abstract, only the title and translation instructions are sent; no abstract or summary is generated. The model API key is sent only to the configured HTTPS service address. The provider determines its own data retention rules.
- Automatic mode can call the model after a qualifying hover and may incur charges. Generation can instead require a click. Dismissing the interface does not guarantee cancellation of charges already incurred at the provider.

Interface and output languages can independently be set to Simplified Chinese, English, French or German; both default to Simplified Chinese. Language settings are stored locally. Changing only the interface language reuses the generation cache; different output languages use separate cache entries. Translations do not overwrite the original paper information.

## Local storage

Keys are stored in the extension's browser session storage by default and are cleared when the browser restarts. If local key persistence is selected, keys are saved in local extension storage. This is not a system password vault or a promise of encrypted custody. Keys are not written to web pages, sync storage, analytics or logs, and page content scripts cannot read key storage. Keys can be cleared at any time.

Paper data and generated results are cached only locally. The generation cache is limited to 200 records, seven days and 4 MiB; results for different models or output languages each occupy a separate entry, even for the same paper. Clearing the cache, clearing keys and uninstalling the extension have their respective local deletion effects. They cannot delete data already received by a service provider.

## Permissions and controls

The extension runs only on Scholar paper search pages. OpenAlex and Crossref permissions allow metadata access. Access to a custom model domain is requested separately when the user saves configuration. The optional HTTPS domain range in the manifest supports user-defined addresses; installation does not grant access to every website.

This version has no ads, automatic telemetry or background uploads of usage records. Test diagnostics are stored locally; inspect them before sharing. Model output may be incorrect. Abstract translations and summaries identify their source basis and cannot substitute for conclusions from the full paper or a paper quality score. Live-page trials and human review, including native-speaker review in all four languages, remain incomplete.

This test package has not been publicly released. Public GitHub publication awaits the user's explicit confirmation after a trial. Before an official store release, the publisher must provide a working contact channel and a public URL for this privacy notice on the store page.

## Explicit saving and export (0.3.0)

Save paper stores metadata, source links and available translations in a separate local collection, limited to 200 papers and 4 MiB, without automatic expiry. Records remain until removed, cleared or the extension is uninstalled. The seven-day generation-cache expiry and Clear cache do not clear this collection. Successful later generation updates an existing saved entry only when its source content still matches.

Export Markdown and originals uses the downloads permission to create a Markdown file and attempt known full-text PDF downloads. Requests go to the full-text provider and Chrome includes existing cookies for that site; model and OpenAlex keys are never sent there. Full text is not sent to a model for analysis. Failed or unavailable PDFs show a reason; the first failed source page in each batch opens automatically, with links for the others. Users complete sign-in, institutional authentication and CAPTCHA themselves.

The latest batch filenames, source links and transfer states are stored locally for checking and retry. Non-PDF responses are not marked successful; the extension attempts to remove only that invalid file newly created by the batch. Normal exported files remain in the browser download directory after collection deletion, cache clearing or extension removal. No background uploads or telemetry are added.
