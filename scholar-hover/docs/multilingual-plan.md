# Multilingual 0.2.0 implementation plan

Approved scope on 2026-09-15: Simplified Chinese, English, French and German, with independent interface and generated-output language selectors. Finish locally first; publish to GitHub only after the user explicitly confirms the trial. Existing 0.1.0 ZIP remains available.

1. Shared contracts: add a fixed four-language union and safe Chinese defaults; rename generated text fields to language-neutral names and record the output language. Keep existing settings, credentials and source provenance intact.
2. Background: migrate missing settings to Chinese, put output language and a new prompt version in cache fingerprints, exclude interface language, validate multilingual JSON without treating sentence punctuation as proof of translation quality. Keep no-abstract and request limits.
3. Content and settings: translate all interface text, errors, data notices and manifest metadata; load preferences before metadata resolves; retain input fields, focus and status across redraws. Ignore responses from an old output-language revision and allow independently changing the interface language.
4. Delivery: provide English and Chinese documentation, MIT license, contribution instructions and an offline CI workflow. Prepare version 0.2.0 ZIP without publishing.
5. Verification: test migration, all four prompts and interfaces, cache separation/reuse, failed generation, switching language during requests, permission denial and data notices. Run complete tests, build and packaged browser checks. Report machine-tested scope separately from human translation accuracy and live Scholar/user validation.
