# Contributing

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

Language support is defined in `src/shared/languages.ts`; card and options dictionaries are in `src/content/messages.ts` and `src/options/messages.ts`. Chrome metadata lives in `public/_locales/`, while known backend diagnostics are localized in `src/shared/errors.ts`. Add every language consistently, including data notices and tests. Model language instructions are not proof that output is in the correct language: review scientific numbers, negation and conclusion strength with qualified readers. Interface changes must not invalidate generated-text caches; output-language changes must.

Do not commit API keys, browser profiles, private papers, local credentials, `node_modules`, generated build/release files or machine-specific paths. Describe reproduction steps without secrets. The repository has no public contact endpoint yet; publication and reporting channels will be finalized after the owner's trial approval.

GitHub Actions runs tests and builds with read-only repository permissions. It does not publish a release or upload to the Chrome Web Store. New contributions are provided under the repository's MIT license; third-party data and services retain their own terms.
