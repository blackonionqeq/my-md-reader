# Offline Image Caching Design

> Historical design: the IndexedDB Blob/object-URL delivery decisions in this
> document were superseded on 2026-07-16 by
> [Cache Storage Image Migration Design](./2026-07-16-cache-storage-image-migration-design.md).
> IndexedDB now retains asset ownership and retry metadata, while Cache Storage
> is the binary source of truth and the Workbox service worker serves normal
> HTTP(S) image requests.

Date: 2026-05-17

## Goal

Extend remote article download so Markdown images are cached for offline reading together with article content. The reader should download all `http` and `https` image resources referenced by a remote Markdown article, rewrite successful image references to local cached resources, and retry failed image downloads with increasing delays up to five attempts.

## Scope

In scope:

- Parse remote Markdown articles for inline image references during article download.
- Resolve relative image URLs against the article URL.
- Download all resolved `http` and `https` image resources referenced by the article.
- Persist image cache records in IndexedDB.
- Rewrite Markdown image URLs to local cached references when an image is successfully cached.
- Retry failed image downloads with increasing backoff delays, up to five total attempts per image.
- Keep article text readable even when some images fail permanently.
- Remove cached image records when a group is removed or all data is cleared.
- Add unit tests for image extraction, URL rewriting, retry scheduling, and failure fallback.

Out of scope:

- Background sync through the Service Worker.
- Downloading non-image attachments such as PDF, audio, or video assets.
- Rewriting arbitrary HTML `img` tags inside raw embedded HTML blocks.
- Cross-article deduplication of the same image URL.
- Visual progress UI for individual image retries.

## Current Problem

The current remote download flow stores only Markdown article text in `articles.content`. If a downloaded article references remote images, those images still load from the network at render time. This breaks the expected offline reading experience because article text remains available offline while images disappear.

The codebase already includes an `assets` table shape in Dexie, but it is not yet used by the download pipeline.

## Approach

### 1. Treat image caching as part of article download

When `downloadGroup` fetches a remote article successfully, the service should immediately inspect the Markdown body for image references, resolve each image URL relative to the article URL, and queue every `http` or `https` image for caching.

The article download remains the top-level user action. Image download work is attached to that action rather than being moved into the rendering layer. This keeps the offline contract simple: if an article is downloaded, the app has already attempted to localize its images.

### 2. Store per-image cache state in IndexedDB

The `assets` table will become the source of truth for image download progress and retry state. Each asset record should include:

- `id`: stable local ID.
- `articleId`: owning article.
- `originalUrl`: resolved remote image URL.
- `localObjectUrl`: current browser object URL used during rendering when available.
- `mimeType`: response content type when available.
- `status`: `pending`, `downloading`, `downloaded`, or `failed`.
- `attemptCount`: number of completed attempts.
- `nextRetryAt`: ISO timestamp for the next allowed retry when pending.
- `lastError`: most recent failure message.
- `createdAt`.
- `updatedAt`.

Binary image bytes should also be stored in IndexedDB so a fresh app session can recreate object URLs without refetching the network resource. The implementation may store the payload as a `Blob` on the asset record or in an adjacent persisted field on the same table.

### 3. Rewrite Markdown after cache results are known

The download pipeline should produce an offline-ready Markdown body rather than relying on DOM-time URL substitution. After image download attempts finish for the current run, the service rewrites Markdown image URLs as follows:

- If the image was cached successfully, replace the original Markdown URL with a local object URL derived from the stored blob.
- If the image is still pending retry or has permanently failed, keep the original remote URL in the Markdown body.

This preserves compatibility with the existing renderer, which already converts Markdown to HTML without any asset-aware customization.

### 4. Retry failed images after the first pass

Image download should use a queue local to the current article download operation:

1. Queue every discovered image.
2. Attempt each image once during the initial pass.
3. Failed images are re-enqueued with an increasing delay.
4. After all immediate work completes, the queue waits until the next due retry and tries failed images again.
5. Each image stops retrying after five total attempts.

The delay should increase on each failure so repeated transient network errors do not hammer the origin. A simple stepped schedule is sufficient for version 1. Recommended retry delays:

- Attempt 2: 1 second after the first failure.
- Attempt 3: 3 seconds later.
- Attempt 4: 10 seconds later.
- Attempt 5: 30 seconds later.

If the fifth attempt fails, the asset remains `failed` and keeps its original URL in the Markdown text.

### 5. Keep article availability independent from image completeness

Article text should not be blocked by one broken image. Once the Markdown body is downloaded, the article remains readable. The `Article.downloadStatus` continues to represent the article body download result, not a strict all-assets-success result.

Behavior:

- If article Markdown fetch fails, the article stays `failed`.
- If article Markdown fetch succeeds and some images are still retrying, the article can still be considered downloaded once the current cache-and-rewrite operation completes.
- If some images fail permanently after five attempts, the article remains downloaded, but those image references stay remote.

This keeps group download semantics aligned with reader usefulness: users can still read the article offline even if a subset of images could not be cached.

## Data Flow

### Remote Article Download With Image Caching

1. Fetch Markdown text from the article URL.
2. Parse Markdown image syntax and collect candidate image URLs.
3. Resolve each candidate relative to the article URL.
4. Create or update asset records as `pending`.
5. Run the image queue for the article.
6. For each successful image response, persist the blob and mark the asset `downloaded`.
7. For each failed image response, increment `attemptCount`, store `lastError`, and either schedule `nextRetryAt` or mark the asset `failed` after the fifth attempt.
8. After the queue completes, rebuild the Markdown body with local references for successful assets and original references for incomplete or failed assets.
9. Save the rewritten Markdown into `articles.content`.
10. Mark the article itself `downloaded`.

### Reader Session Startup

When a downloaded article is opened, the service or rendering helper should ensure that any persisted cached image blobs can be exposed again as object URLs for the current session before rendering. This recreation step must avoid network access.

### Data Removal

- `removeGroup` deletes all assets belonging to the group's articles before removing those articles.
- `clearAllData` clears the assets table together with the existing tables.
- If object URLs are created, revoke them when replacing them or when clearing cached in-memory references to avoid leaking browser memory.

## File-Level Changes

- `src/lib/content-service.ts`: add Markdown image extraction, asset persistence, retry queue execution, Markdown rewriting, and asset cleanup logic.
- `src/lib/types.ts`: expand the `Asset` type with persisted blob metadata and retry fields.
- `src/lib/db.ts`: update the Dexie schema version and indexes for asset retry queries.
- `src/lib/content-service.test.ts`: add tests for image caching behavior and retries.
- `src/lib/markdown.ts` or a nearby helper: optionally add a small helper for recreating object URLs from persisted blobs if this is cleaner than placing it fully in `content-service.ts`.

## Error Handling

Article fetch failure:

- Preserve the current article-level `failed` status behavior.

Image fetch failure before the fifth attempt:

- Keep the asset in the retry queue with an updated `nextRetryAt`.
- Do not fail the article.

Image fetch failure on the fifth attempt:

- Mark the asset `failed`.
- Keep the original remote image URL in the Markdown content.

Blob persistence failure:

- Treat it as an image download failure and route it through the same retry path.

Malformed or unsupported image URL:

- Ignore non-`http/https` targets for remote caching and leave the original Markdown reference unchanged.

## Testing Strategy

Unit tests should cover:

- Extraction of Markdown image references from article content.
- Resolution of relative image URLs against the article URL.
- Rewriting only successful images to local cached references.
- Queue retry scheduling with increasing delays.
- Transition to permanent failure after five attempts.
- Preservation of article `downloaded` status when some images fail.
- Cleanup of associated assets on group removal.

Implementation tests may mock `fetch`, time progression, and IndexedDB writes rather than relying on browser-level automation.

## Expected Outcome

After this change, downloading a remote article also attempts to localize all Markdown image resources. Downloaded articles remain readable offline with cached images when available, transient image failures are retried automatically up to five times, and permanently failing images degrade gracefully without breaking article access.
