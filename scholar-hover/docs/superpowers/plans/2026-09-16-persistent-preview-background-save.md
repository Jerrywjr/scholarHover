# Persistent previews and immediate collection saving

User-approved scope: retain every loaded paper and paid translation until explicit clearing; restore a preview in one cached read; accept Save immediately and finish metadata and translation in the background.

## Data and trust boundaries

- IndexedDB stores resolved previews keyed by version-sensitive Scholar seed identity and generated output keyed by the existing content/configuration fingerprint. Migrate existing generated records before deleting their originals. No automatic age/count eviction. Explicit Clear Cache leaves the saved collection intact.
- The same-tab session registry remains the authority for generating a registered paper. GET_PREVIEW hydrates it from trusted extension storage. A page can submit only validated seed fields, not arbitrary abstracts or download URLs.
- Saved entries have stable IDs and creation tokens even when a provisional Scholar record becomes an OpenAlex record. Saving acknowledges durable local storage before network work. Entry order is click/save order.
- A serial background queue resolves metadata, pauses ambiguous matches for confirmation, checks consent/configuration, reuses generated output, and then generates once. Preview and saved jobs share in-flight resolution/generation promises.
- Failures never automatically repeat paid calls. Worker recovery resumes work that has not reached the model; an interrupted model request requires explicit retry. Removed entries are never recreated by a late response.
- Cached text is usable without an API key or network permission. Cache write failure returns valid model output with a visible warning and keeps an in-memory copy for this worker lifetime.

## Implementation ownership

1. Archive and identity module plus migration tests: persistent_preview_archive.
2. Stable collection store and guarded updates: instant_collection_store.
3. Cache-first card and early save, manager progress/retry/confirmation: collection_manager.
4. Router, recoverable queue, integration tests, documentation and package: root.

## Validation

Unit tests cover durable migration, version-sensitive identity, instant acknowledgment, shared requests, cache-only reopens, missing credentials, ambiguous matches, failure/retry, restart interruption, delete/re-add races and saved ordering. Browser checks use local mock metadata/model services and real extension IndexedDB/offscreen execution. Build and installable ZIP must match the final source. Real service availability and translation quality remain subject to user trial; do not publish publicly yet.
