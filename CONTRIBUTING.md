# Contributing

Scholar Hover 0.4.0 is an open-source experimental release. Bug reports, documentation improvements, language review and focused pull requests are welcome at [Jerrywjr/scholar-hover](https://github.com/Jerrywjr/scholar-hover).

Report reproducible problems through [GitHub Issues](https://github.com/Jerrywjr/scholar-hover/issues). Include the extension and Chrome versions, reproduction steps, expected and actual behavior, and a public paper link or DOI when relevant. Model compatibility reports should identify the provider and API model name without credentials. Issues are public: remove API keys, login details and private content before attaching screenshots, logs or example exports.

## Development

Use Node.js 22 and npm. From the repository root:

```sh
cd scholar-hover
npm ci
npm test
npm run test:corpus
npm run build
npx playwright install chromium
npm run test:e2e
npm run package
```

The browser suite loads the built MV3 extension in an isolated Chromium profile with offline page and provider fixtures. No real model key is needed. Dependency/browser installation uses the network; the test fixtures do not query Scholar or model services. Real optional-permission prompts and model compatibility require separate manual testing.

Keep changes focused and include regression tests when changing matching, credentials, cache identity or asynchronous UI behavior. Never relax matching to silently combine a preprint with a published paper. When no abstract exists, generated output may translate only the title.

All paths in this paragraph are relative to `scholar-hover/`. Language support is defined in `src/shared/languages.ts`; interface dictionaries are in `src/content/messages.ts`, `src/options/messages.ts` and `src/collection/messages.ts`. Chrome metadata lives in `public/_locales/`, while known backend diagnostics are localized in `src/shared/errors.ts`. Add every language consistently, including data notices and tests. Model language instructions are not proof that output is in the correct language: review scientific numbers, negation and conclusion strength with qualified readers. Interface changes must not invalidate generated-text caches; output-language changes must.

Do not commit API keys, browser profiles, private papers, local credentials, `node_modules`, generated build/release files or machine-specific paths. Describe reproduction steps without secrets.

GitHub Actions runs tests and builds with read-only repository permissions. It does not publish a release or upload to the Chrome Web Store. New contributions are provided under the repository's MIT license; third-party data and services retain their own terms.

## Evaluation and release scope

The GitHub release provides source and an unpacked-extension ZIP; it is not a Chrome Web Store release. Live Scholar matching, scientific translation checks, native-speaker review and the user-value study remain incomplete. Keep these limits explicit in documentation and reports. In particular, passing offline fixtures does not establish real-world matching accuracy or a reduction in screening time.
