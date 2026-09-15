# GitHub publication preparation

Status on 2026-09-15: local preparation only. The user explicitly requested publication **after trial confirmation**. The connected GitHub account is `Jerrywjr`; no repository was created, no remote configured and no source uploaded in this stage.

The repository root is the directory containing `LICENSE`, `CONTRIBUTING.md`, `.github/` and the `scholar-hover/` source directory. Prepare that project only; unrelated neighboring workspace projects are outside the publication scope. The source uses the MIT license. Third-party services/data keep their own terms.

Before publishing, record the owner's trial result, resolve reported defects, update the version and rerun the build/tests. Check the selected repository name and existing remote contents before creating or pushing anything. Publish the source, README, license, tests, offline evaluation scaffolding and CI configuration; attach the matching unpacked-extension ZIP and SHA-256 to a release if requested. Generated directories, credentials, browser profiles and local test diagnostics are excluded by `.gitignore`.

Describe the release as experimental while human evaluation remains incomplete. Do not claim that offline fixtures measure real Scholar accuracy or that all four languages have received human/native-speaker review. Publishing source code does not supply JIF rights or imply Chrome Web Store publication. The Actions workflow performs checks only; it contains no automatic release or deployment step.
