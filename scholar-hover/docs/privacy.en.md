# Scholar Hover · Privacy notice

Version 0.2.0 · 2026-09-15

[简体中文](privacy.md) · [Français](privacy.fr.md) · [Deutsch](privacy.de.md)

This extension only enhances search results pages that the user opens at https://scholar.google.com/scholar. It reads the triggered result's title, authors, year, publication venue and links to identify the paper. It does not automate searching, pagination or full-text retrieval, and has no product account or project-operated server.

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
