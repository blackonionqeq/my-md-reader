# Cache Storage Image Migration Design

Date: 2026-07-16

## Goal

Migrate offline Markdown images from IndexedDB `Blob` records and session-scoped
`blob:` URLs to Cache Storage responses served by the existing Workbox service
worker. The migration must remove the image rendering path that fails in the
iPadOS 17.6 installed PWA while preserving explicit group downloads, offline
reading, retries, progress reporting, and cleanup.

## Success Criteria

- Downloaded images render after refresh and after fully restarting the PWA on
  iPadOS 17.6.
- Downloaded images render with the device offline.
- Rendering a downloaded article does not call `URL.createObjectURL()`.
- Cross-origin images without CORS headers can be cached as opaque responses.
- Existing `mdr-asset://` articles migrate without requiring users to delete
  their bookshelf.
- An article is not reported as having a cached image until `cache.match()`
  verifies that the response is present.
- Removing content deletes image cache entries that are no longer referenced by
  another article.
- Desktop, Android, and newer iOS behavior remains unchanged.

## Non-Goals

- Caching PDFs, audio, video, or arbitrary HTML resources.
- Cross-article content-addressed deduplication.
- Background Sync while the PWA is closed.
- Replacing Dexie for sources, groups, articles, reading state, or asset
  metadata.
- Switching from `generateSW` to a fully custom `injectManifest` service worker.

## Current Failure Path

The current download path stores each successful image response as a `Blob` on
an `assets` record and rewrites the Markdown URL to an `mdr-asset://` placeholder.
Opening the article performs this conversion:

```text
IndexedDB Blob -> ArrayBuffer -> rebuilt Blob -> blob: URL -> <img>
```

Rebuilding the Blob repairs missing MIME metadata and some IndexedDB-backed Blob
issues, but it still depends on the installed PWA loading a `blob:` resource.
That final dependency remains unreliable on the affected iPadOS release.

## Target Architecture

The target read path is:

```text
absolute image URL -> service worker -> Cache Storage Response -> <img>
```

Responsibilities are divided as follows:

- `content-service.ts` owns explicit downloads, retry state, asset ownership,
  legacy migration, and cleanup coordination.
- A focused image-cache helper owns Cache Storage operations and request mode
  selection.
- Workbox owns fetch interception and CacheFirst delivery to `<img>` requests.
- IndexedDB keeps asset metadata but is no longer the long-term binary store.
- Markdown rendering receives normal `http:` or `https:` image URLs and has no
  knowledge of Cache Storage.

## Cache Contract

### Cache name

Use one versioned cache name shared by application code and Workbox:

```text
md-reader-images-v1
```

Export the name from one source module where practical so download, cleanup,
tests, and generated Workbox configuration do not drift.

### Cache key

Use the fully resolved original image URL as the cache key. The same URL must be
used in rendered Markdown so the browser request matches the prefilled entry.
Query strings remain part of the key because they may carry a real content
version or signature.

### Accepted responses

Treat these responses as cacheable:

- Same-origin or CORS responses with HTTP status `200`.
- Cross-origin `no-cors` responses whose type is `opaque` and exposed status is
  `0`.

Reject HTTP errors, `opaqueredirect` responses, and failed fetches. A successful
`cache.put()` is not sufficient by itself: follow it with `cache.match()` before
marking the asset `downloaded`.

### Request mode

- Use a normal request for same-origin images.
- Use `mode: 'no-cors'` for cross-origin images so resources that already work
  in `<img>` do not require CORS headers merely to support explicit download.

## Workbox Route

Keep the current `generateSW` strategy and add an image route before any overly
broad runtime routes:

- Match `request.destination === 'image'` rather than file extensions. This
  includes extensionless CDN and signed image URLs.
- Use `CacheFirst` with `md-reader-images-v1`.
- Accept cacheable response statuses `[0, 200]`.
- Do not apply a generic entry-count or age expiration policy to this cache.
  Workbox expiration cannot distinguish an explicitly downloaded offline image
  from an incidental runtime entry and could violate the offline contract.

Explicitly downloaded entries and runtime-cached entries share the same cache.
An explicit download always performs a network fetch and overwrites the key so
redownloading a changed collection refreshes stale image bytes.

## New Download Flow

For each resolved Markdown image URL:

1. Create or reuse its asset metadata record.
2. Mark the asset `downloading`.
3. Fetch using the origin-appropriate request mode.
4. Validate the response as `200` or opaque.
5. Put a cloned response into `md-reader-images-v1`.
6. Confirm the entry with `cache.match()`.
7. Mark the asset `downloaded` only after confirmation.
8. On failure, preserve the existing five-attempt backoff behavior.
9. Rewrite successful image references to stable `mdr-asset://` placeholders as
   today, retaining asset ownership metadata in the article.

Keeping the placeholder in persisted Markdown avoids losing the relationship
between an article and its assets. The placeholder is converted to the asset's
absolute `originalUrl` for rendering, not to a Blob URL.

## New Read Flow

When opening an article:

1. Load asset metadata for the article.
2. Replace each known `mdr-asset://<id>` placeholder with `asset.originalUrl`.
3. Do not read a Blob and do not call `URL.createObjectURL()`.
4. Let the controlled service worker satisfy the image request from Cache
   Storage.
5. If the cache entry is absent and the device is online, CacheFirst falls back
   to the network and stores a valid response.
6. If the entry is absent and the device is offline, show the normal broken-image
   fallback and record a diagnostic event rather than hiding the failure.

The current object URL registry and revocation logic can be deleted after the
legacy migration no longer uses it.

## Existing Data Migration

Migration must be incremental and crash-safe because Cache Storage and
IndexedDB cannot participate in one atomic transaction.

For each legacy asset referenced by an opened article or processed by a
background migration pass:

1. Check `md-reader-images-v1` for `asset.originalUrl`.
2. If present, treat the Cache Storage copy as authoritative.
3. Otherwise, if a legacy Blob exists, read its bytes, rebuild a Response with a
   normalized image MIME type, and put it in Cache Storage.
4. If the Blob cannot be read and the app is online, redownload the original URL
   using the new request flow.
5. Verify the new entry with `cache.match()`.
6. Only after verification, update metadata and remove the legacy `blob` field
   from IndexedDB.
7. If migration fails offline, retain the legacy record and report that the
   image requires a network retry. Do not discard the only remaining copy.

Run migration for the selected article before it renders. Process remaining
downloaded assets opportunistically in small batches after initial app startup
so a large bookshelf does not block the UI or create a large memory spike.

No Dexie version bump is required for the first migration release because the
existing indexes do not change and the legacy `blob` field must remain readable
during transition. Removing the field is an ordinary record update. A future
schema change still requires the documented v3 migration.

## Cleanup And Shared URLs

Cache Storage naturally deduplicates identical URLs even though asset metadata
is owned per article. Cleanup must therefore be reference-aware:

- When deleting a group, collect its asset URLs.
- Delete the group's asset metadata.
- For each collected URL, query remaining asset metadata.
- Delete the Cache Storage entry only when no remaining asset references it.
- After startup migration, reconcile cache keys against all asset metadata and
  delete unreferenced entries created by ordinary online image viewing. Never
  run reconciliation before legacy asset metadata has loaded successfully.
- `clearAllData()` deletes the complete `md-reader-images-v1` cache alongside
  the IndexedDB tables.
- A cache-version change deletes obsolete `md-reader-images-*` caches after the
  new service worker activates.

This prevents deleting a shared cached image still used by another collection.

## Failure Handling And Diagnostics

Do not retain the current silent `catch` behavior for asset hydration or cache
operations. Capture enough structured information to distinguish:

- Service worker not controlling the page.
- Cache miss while offline.
- Cache API unavailable or rejected.
- Quota exhaustion.
- Network or HTTP failure.
- Opaque response acceptance failure.
- Legacy Blob read failure.
- `<img>` decode or unsupported-format failure.

User-facing messages should remain concise. Detailed diagnostics may go to the
console and asset `lastError`, while the directory exposes failed image counts
through the existing retry affordance.

## Service Worker Update Behavior

The migration changes the runtime fetch contract, so activation must be
observable:

- Mount the existing update UI or otherwise provide an explicit reload path when
  a new service worker is waiting.
- Confirm `navigator.serviceWorker.controller` before claiming offline images
  are ready.
- Do not delete legacy Blob data until the new image route controls the page and
  the corresponding cache entries have been verified.
- Include a build or application version in diagnostics so a device can prove
  which release is running.

## File-Level Plan

- `src/lib/image-cache.ts`: cache name, request creation, response validation,
  put/match/delete helpers, and legacy Blob-to-Response migration.
- `src/lib/image-cache.test.ts`: same-origin, opaque cross-origin, verification,
  deletion, and migration tests.
- `src/lib/content-service.ts`: replace Blob persistence with cache writes,
  resolve placeholders to original URLs, coordinate migration, and make cleanup
  reference-aware.
- `src/lib/content-service.test.ts`: update download, hydration, retry, legacy
  migration, and shared-URL cleanup coverage.
- `src/lib/types.ts`: retain transitional legacy Blob typing only as long as the
  migration requires it; document Cache Storage as the binary source of truth.
- `vite.config.ts`: add the Workbox CacheFirst image route using the shared cache
  contract and `[0, 200]` response statuses.
- `src/App.svelte` and PWA registration code: expose service worker activation
  and version diagnostics without moving persistence logic into the component.
- Existing offline image design documentation: update after implementation if
  behavior differs from its original Blob-based decisions.

## Implementation Sequence

### Phase 1: Cache abstraction

1. Add Cache Storage helpers with unit tests.
2. Define request modes and valid response rules.
3. Add verified writes and reference-aware deletes.

### Phase 2: Service worker delivery

1. Add the Workbox image route.
2. Build the production service worker.
3. Verify generated output contains the route, cache name, and opaque-response
   policy.

### Phase 3: New downloads and reads

1. Write newly downloaded images to Cache Storage.
2. Stop persisting new image Blob payloads.
3. Resolve placeholders to absolute URLs during article open.
4. Remove Blob URL creation from the normal read path.

### Phase 4: Legacy migration and cleanup

1. Migrate the selected article synchronously before render.
2. Migrate remaining assets in bounded background batches.
3. Remove legacy Blob fields only after cache verification.
4. Update group removal and full-data cleanup.

### Phase 5: Observability and release verification

1. Surface service worker version/control state.
2. Record cache and image-load failures.
3. Run automated checks and the device acceptance matrix.
4. Release only after iPadOS 17.6 passes offline restart testing.

## Automated Verification

- `pnpm check`
- `pnpm test`
- `pnpm build`
- Confirm the generated service worker registers the image CacheFirst route.
- Confirm no production read path calls `URL.createObjectURL()` for article
  images.
- Test successful same-origin and opaque cross-origin caching.
- Test cache verification failure leaves the asset retryable.
- Test a legacy Blob is removed only after a verified cache write.
- Test a failed offline migration preserves the legacy Blob.
- Test deleting one of two articles sharing a URL preserves the cache entry.
- Test deleting the final reference removes the entry.
- Test `clearAllData()` deletes the image cache.

## Device Acceptance Matrix

Run each scenario on desktop Chromium, Android Chrome PWA, iPadOS 17.6 installed
PWA, and a current iOS/iPadOS installed PWA:

1. Install or update the PWA and confirm the new service worker controls it.
2. Import a collection containing PNG/JPEG, WebP, extensionless, and cross-origin
   images.
3. Download the collection and confirm every expected image is verified cached.
4. Refresh while online.
5. Fully terminate and reopen while online.
6. Enable airplane mode, refresh, and navigate between articles.
7. Fully terminate and reopen while still offline.
8. Upgrade a device containing legacy IndexedDB Blob assets without clearing
   application data.
9. Remove one group and verify unrelated/shared images still render offline.
10. Clear all data and verify image cache storage is removed.

## Rollout And Rollback

- Deploy behind a new cache version so it does not mutate the previous runtime
  cache accidentally.
- Keep the migration idempotent; interrupted devices resume from `cache.match()`
  results.
- Do not remove a legacy Blob before the new cache entry is verified and the
  service worker controls the page.
- If rollback is required after legacy fields have been removed, affected images
  must be redownloaded by the old release. Document this operational limitation
  in the release notes.

## Expected Outcome

Offline article images become normal image requests backed by Cache Storage and
the service worker. The application no longer depends on IndexedDB Blob
deserialization or `blob:` URL loading for article rendering, eliminating the
known fragile path on iPadOS 17.6 while preserving the existing offline reader
model and providing explicit evidence when caching fails.
