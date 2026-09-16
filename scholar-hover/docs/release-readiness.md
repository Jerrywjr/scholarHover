# Release status and remaining checks

Version **0.4.0** is an open-source experimental release at [Jerrywjr/scholar-hover](https://github.com/Jerrywjr/scholar-hover), under the [MIT license](../../LICENSE). Installable artifacts belong to the [v0.4.0 GitHub release](https://github.com/Jerrywjr/scholar-hover/releases/tag/v0.4.0). Bugs and feature requests can be reported through [GitHub Issues](https://github.com/Jerrywjr/scholar-hover/issues); reports are public and must not include credentials or private content.

The GitHub release is for manual installation and feedback. The extension has not been submitted to or published in the Chrome Web Store, and open-source publication does not certify matching accuracy, translation quality or screening efficiency.

## Release artifacts and reproducibility

The repository contains source, English and Chinese documentation, the license, tests, evaluation scaffolding and an inactive CI example. The extension source lives in `scholar-hover/`. The release ZIP must be built from its matching source tag, with its SHA-256 checksum attached alongside it. Credentials, browser profiles, generated build directories and local test diagnostics are excluded from source control. A release ZIP is an unpacked extension, not a signed store package.

The [0.4.0 test report](test-report-0.4.0.md) records the local automated checks and their limitations. Reproduction commands are in the [development guide](../README.md#development-and-reproducible-checks). Hosted GitHub Actions is not enabled because the initial publishing credentials lack workflow-writing permission. An authorized maintainer can enable the [workflow example](../../docs/ci/README.md); it performs checks only and contains no automatic release or store-deployment step.

## Remaining evaluation

- Validate the fixed corpus against actual Scholar inputs and human decisions. Offline fixtures and metadata-derived inputs do not establish real-world matching accuracy.
- Have qualified readers check scientific numbers, negation and conclusion strength in translations, including native-speaker review of each supported language. Four-language support does not imply that this review is complete.
- Complete the planned user study before claiming improved screening time or unchanged error rates. Small pilot results would support an initial assessment, not a general effectiveness claim.
- Test real Chrome permission prompts and provider compatibility separately from the controlled browser fixtures.

## Before a Chrome Web Store submission

Review live-use feedback and unresolved defects, then update screenshots, listing details and permission explanations against the version being submitted. The [store listing](store-listing.md) is a draft. Confirm that its public privacy URL and support link remain accessible and describe the actual data flows. Third-party data and services retain their own terms; open-source publication supplies no JIF data rights.
