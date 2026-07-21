# Manifest Incremental Update Design

Date: 2026-07-21

## Goal

Add an explicit, previewable incremental-update workflow for remote manifest
collections. The reader compares the applied manifest with a newly fetched
manifest, imports added articles, permanently removes missing articles, updates
metadata in place, and downloads only articles whose content may have changed.

The workflow must preserve offline readability when a replacement download
fails. Existing content remains readable until its replacement Markdown and
images have been fetched and verified. Collections remain offline-first: the
application checks for updates only when the user requests it.

The same comparison flow also handles a relocated manifest. When the user
imports a new URL whose top-level manifest `id` matches an existing manifest
collection, the reader offers to update that collection and replace its stored
source URL rather than creating a duplicate.

## Success Criteria

- Manifest-backed groups expose a manual **Check for updates** action.
- Checking fetches and validates the stored manifest URL without modifying the
  applied collection.
- The user sees article-level added, removed, content-changed, and
  metadata-changed entries before applying an update.
- Applying a confirmed plan permanently removes articles absent from the new
  manifest, including their content, reading state, favorite state, asset
  ownership, and unreferenced cached images.
- Articles with unchanged identities and content retain their downloaded
  Markdown, image metadata, reading progress, and favorite state.
- A changed article that was previously downloaded is refreshed automatically.
  Its old content remains readable if the refresh fails.
- A new article is downloaded automatically only when the group was completely
  downloaded before the update. Otherwise it is added as not downloaded.
- A downloaded Markdown response is accepted only when its SHA-256 digest
  matches the manifest's `contentHash`, when one is present.
- Manifests without article hashes remain importable and receive a documented,
  conservative fallback when the top-level `version` changes.
- A user-supplied replacement URL with the same manifest `id` can update the
  existing source URL after an explicit relocation confirmation.
- A changed top-level manifest `id` from the stored update URL is rejected as a
  different collection.
- Existing manifest data migrates from Dexie v2 to v3 without losing content,
  reading state, favorites, assets, or source relationships.

## Non-Goals

- Automatic checks at startup, on group selection, or on a timer.
- Background sync from the service worker.
- Manifest or article version history, rollback, or a recycle bin.
- Preserving records for articles explicitly removed by the publisher.
- Cryptographically authenticating a publisher. SHA-256 detects content
  mismatch; it does not establish trust in the manifest.
- Supporting multiple local groups with the same top-level manifest `id`.
- Automatically discovering a new manifest URL after the old URL stops working.
- Adding Playwright or another browser-automation framework.

## Manifest Contract

Keep `schemaVersion: 1` because the new article field is optional and therefore
backward compatible. Add `contentHash` to article entries:

```json
{
  "schemaVersion": 1,
  "id": "rust-course",
  "title": "Rust Course",
  "version": "2026.07.21",
  "articles": [
    {
      "id": "ownership",
      "title": "Ownership",
      "url": "articles/ownership.md",
      "order": 1,
      "contentHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ]
}
```

The actual value after `sha256:` contains exactly 64 hexadecimal characters.
Validation normalizes it to lowercase. The digest is calculated from the exact
HTTP response bytes of the Markdown resource, before UTF-8 decoding or newline
conversion. Manifest-producing automation must calculate the digest from the
final file written to disk; an AI model must not invent or estimate it.

The top-level `version` remains a publisher-controlled, human-readable release
label. It is useful in the UI and is the fallback change signal for legacy
manifests, but it is not trusted as the precise per-article identity. The client
also computes a canonical manifest fingerprint. That fingerprint is an
internal equality and stale-plan check, not a field embedded in the manifest.

The top-level `id` is the stable collection identity and must not change across
updates or URL relocation. Each article `id` is stable within that collection.
Changing an article ID has delete-and-add semantics and therefore removes the
old article's reading state and favorite.

## Canonical Manifest Fingerprint

Compute the fingerprint only after validation and normalization. Construct a
canonical object containing:

- `schemaVersion`, `id`, `title`, normalized optional `description`, and
  normalized optional `version`;
- every article's `id`, `title`, resolved absolute URL, effective order, and
  normalized optional `contentHash`.

Sort canonical article objects by article ID, serialize fields in a fixed order,
and calculate SHA-256 over the UTF-8 JSON serialization. Effective order is the
explicit `order` or the original one-based array index. Consequently, JSON
indentation and object-field order do not cause updates, while changing an
implicit article order does.

The fingerprint includes metadata as well as content hashes. Equal fingerprints
mean there is no new remote manifest change to preview. They do not hide a
previously failed local download: failed or interrupted article status still
offers retry even when the remote manifest fingerprint is already applied.
Different fingerprints require a field-level diff so the UI can explain the
change and the service can choose the correct work.

## Persistent Model And Migration

Extend the existing types with optional, non-indexed fields:

```ts
interface Source {
  // Existing fields omitted.
  manifestFingerprint?: string;
  lastCheckedAt?: string;
}

interface Article {
  // Existing fields omitted.
  contentHash?: string;
  downloadedContentHash?: string;
}
```

`Article.contentHash` is the target declared by the currently applied manifest.
`Article.downloadedContentHash` identifies the local Markdown currently stored
in `content`. If the values differ and old content exists, the article has a
pending or failed replacement while remaining readable. Hashless legacy
articles leave both fields undefined.

Create Dexie schema v3 using the current indexes. Its upgrade establishes the
new optional shape without guessing hashes for existing content. Existing
manifest `Source.id` values are retained as opaque internal primary keys even
though they contain the original URL. Code must stop deriving behavioral
meaning from those IDs. Newly created manifest sources use a generated stable
internal ID. `Source.url` becomes the mutable update location, while `Group.id`
and the manifest's top-level `id` remain the collection identity.

Migrated sources initially have no stored fingerprint. On their first check,
derive a baseline fingerprint from the persisted group/article metadata using
the fetched schema version. If the derived state equals the fetched manifest,
store that fingerprint as a safe backfill. If it differs, use the derived value
as the plan's base fingerprint and save the target only after confirmation.

No index is required for the new fields. Locating an existing collection during
new-URL import uses the manifest `id`, which is already the group primary key.
If that group exists but is backed by a local or single-URL source, reject the
manifest import as an identity conflict rather than overwriting unrelated data.

Update group offline-status calculation so failed replacement content is
represented accurately:

- `downloaded` only when every article has the current downloaded content;
- `partial` when any current content is missing or stale but at least one
  article remains readable offline;
- `not_downloaded` when no article has local readable content.

## Module Boundaries

### `manifest.ts`

Continue to own input validation, optional hash normalization, manifest URL
resolution, and conversion to normalized domain records. It does not compare a
manifest with stored state and does not access Dexie.

### `manifest-update.ts`

Add a DOM- and database-independent module that owns:

- canonical fingerprint construction;
- field-level manifest comparison;
- legacy change classification; and
- summary counts and ordered preview entries.

Its primary result is a serializable `ManifestUpdatePlan` with the base applied
fingerprint, target fingerprint, old and new source URLs, old and new manifest
versions, the normalized target manifest, and entries classified as `added`,
`removed`, `contentChanged`, `metadataChanged`, or `unchanged`.

### `content-service.ts`

Continue to own all network, persistence, download, retry, deletion, and cache
coordination. Add focused operations for:

- checking the stored URL for one manifest group;
- previewing a newly entered URL as either a new collection or an update/source
  relocation;
- applying a confirmed update plan; and
- retrying failed article replacements.

The service revalidates the plan's group identity and base fingerprint before
application so an old dialog cannot overwrite a collection changed in another
tab or earlier action.

### UI components

`GroupDetail.svelte` exposes the manual update action only for manifest-backed
groups. Add a focused update-preview dialog for the source URL change, version
change, compatibility warning, article lists, destructive-removal warning, and
confirmation controls. `App.svelte` owns dialog/progress orchestration and
refreshes the selected records after completion; it does not calculate diffs or
perform direct database writes.

## Change Classification

Match articles by stable article ID and apply these rules in order:

1. An ID present only in the target is `added`.
2. An ID present only in the applied collection is `removed`.
3. A resolved article URL change is `contentChanged`, even when hashes match,
   because relative image URLs use the Markdown URL as their base.
4. When both sides have `contentHash`, a hash difference is `contentChanged`.
5. Introducing or removing `contentHash` is `contentChanged` for a locally
   downloaded article because the existing bytes cannot be proven equivalent.
6. When hashes are unavailable on both sides and the top-level `version`
   changes, every locally downloaded legacy article is `contentChanged`.
7. A title or effective-order change without a content-affecting change is
   `metadataChanged`.
8. All remaining entries are `unchanged`.

Changing only the group title, description, or version appears in the preview
as group metadata rather than as an article entry. Hashless manifests whose
version did not change can still detect additions, removals, URL changes, title
changes, and order changes, but cannot detect same-URL Markdown edits. The UI
states this limitation explicitly.

## Check And Preview Flow

For the group detail action:

1. Resolve the selected group, then its source through `group.sourceId`.
2. Require `source.type === 'manifest'` and a stored `source.url`.
3. Fetch and validate that URL.
4. Reject the response if its top-level `id` differs from `group.id`.
5. Normalize the target and compute its fingerprint.
6. Compare it with the applied group and articles, deriving a base fingerprint
   from persisted metadata when a migrated source has none.
7. Update `Source.lastCheckedAt` after a successful check; an equal first check
   may also backfill a migrated source's missing fingerprint.
8. Show either an up-to-date message or the update-preview dialog.

When differences exist, do not save the target fingerprint during checking. It
becomes the applied fingerprint only after confirmation. An equal first check
may backfill a missing fingerprint because the persisted metadata already
matches the target. The preview keeps the validated normalized target in memory,
so confirming does not refetch the manifest. A reload or closed dialog discards
that preview and requires a new check.

The dialog lists affected article titles and classifies each change. It clearly
states that removed articles lose content, images, favorites, and progress.
While a check or update is active for a group, disable update, download, retry,
and removal actions for that same group.

## New URL And Source Relocation Flow

The existing add-source form first fetches and validates the entered URL, then
looks up `manifest.id` as a group primary key:

- If no group exists, show the normal new-collection preview and save it with a
  generated stable `Source.id` and the entered `Source.url`.
- If a manifest-backed group exists, build the normal update plan and also mark
  the source URL as changed. The dialog displays the old and new URLs and
  requires explicit confirmation.
- If a non-manifest group has that ID, report an identity conflict and make no
  changes.

On confirmation, retain the existing source primary key and group relationship,
replace `Source.url` with the new URL, and apply the content diff. Future manual
checks use the new URL. Cancelling leaves the old URL and collection unchanged.

The application never infers relocation from a failed old URL. The user must
explicitly provide the replacement URL. Matching IDs are sufficient for this
user-initiated proposal but do not prove publisher authenticity, which is why
the old and new URLs must remain visible at confirmation.

## Apply And Download Flow

Application has a recoverable metadata phase followed by article downloads:

1. Verify that the group, source, source URL, and applied fingerprint still
   match the plan's base values.
2. Record the target manifest metadata and source URL, add new article records,
   update retained article metadata and target hashes, delete removed article
   records and reading states, and mark required downloads in one Dexie
   transaction.
3. Save the target manifest fingerprint because the collection structure is
   now applied, even if some requested content still needs downloading.
4. Permanently delete removed asset ownership records in the same transaction.
5. Download required added and changed articles using the current progress
   callback path.
6. For each article, fetch Markdown bytes, verify `contentHash` when present,
   decode the text as UTF-8, resolve and fetch its images, then replace content
   and asset ownership only after preparation succeeds.
7. Set `downloadedContentHash` to the accepted target hash. Hashless legacy
   downloads leave it undefined but clear their failed state.
8. Recalculate the group offline status and remove image cache entries no
   longer referenced by any asset record.

The pre-update group state determines automatic download intent:

- A newly added article downloads automatically only if the group was fully
  downloaded before application.
- A changed article downloads automatically if that article had local content
  or a downloaded status before application.
- A metadata-only or unchanged article is never redownloaded.
- Articles that were not previously offline remain not downloaded.

For a changed downloaded article, keep its prior `content` and old asset records
while the replacement is prepared. A failure sets an error status but does not
clear that content. Retrying uses the current target URL and hash. For a new
article there is no fallback content, so a failure behaves like the existing
download failure state.

Cache Storage is keyed by original HTTP(S) image URL. Replacement image
responses should be fetched and validated before their asset ownership replaces
the old records. Cache writes that succeeded before a later failure may leave
unreferenced responses, but they do not make the old Markdown unavailable;
normal cache reconciliation removes them later. Do not reintroduce Blob or
object-URL delivery.

## Deletion And Reader Recovery

Removal is intentional and permanent after confirmation. For every removed
article, delete:

- the article record and stored Markdown;
- its `ReadingState`, including favorite and progress;
- its asset ownership records; and
- image responses no longer referenced by any remaining article.

If `Group.lastReadArticleId` points to a removed article, select the closest
surviving article by the old manifest order, preferring the next article and
then the previous article. Clear the field if no article survives. Although a
valid manifest remains non-empty, this fallback also protects against damaged
legacy state.

If the user is reading the affected group, refresh the directory and reader
after application. A surviving current article remains selected and retains its
reading state. A removed current article uses the same nearest-article fallback.
Applying an update while continuous reading is active first exits continuous
mode; completion resumes in the ordinary reader because the virtual slot list
and session HTML cache are based on the old manifest.

## Failure Handling And Recovery

- Network failure, non-success HTTP status, invalid JSON, validation failure,
  or a changed top-level manifest ID during checking performs no collection
  writes. A successful check may update `lastCheckedAt`.
- Invalid `contentHash` syntax rejects the entire manifest.
- A Markdown digest mismatch rejects that article replacement, records a clear
  error, and retains old content when present.
- An article or image download failure does not roll back successful sibling
  replacements or confirmed structural changes.
- Confirmed removals are not restored because another article failed to update.
- A failed source-relocation application leaves the old URL when the initial
  Dexie transaction does not commit. Once that transaction commits, the new URL
  is authoritative and failed article downloads are retryable from it.
- A stale update plan is rejected and the user must check again.
- A page close during download can leave an article marked `downloading`.
  On the next load, normalize interrupted downloads to a retryable failed state;
  retain any old content and show it as an update failure.
- Cache cleanup is best effort after the database transaction. Cleanup failure
  does not report the manifest update as failed and is retried by later cache
  reconciliation.
- A Dexie transaction failure leaves the previously applied database state
  intact. Any cache response prepared before that failure is unreferenced and
  eligible for reconciliation.

When some target content is stale or missing, report completion with failures
and set the group offline status to `partial` when any offline-readable content
remains. The existing retry action includes both first-time failures and failed
replacements.

## User Interface

The group detail view shows **Check for updates** only when the selected source
is a manifest. Display the last successful check time near the action when it is
available. No startup or group-open code invokes the check operation.

The update-preview dialog includes:

- current and target manifest versions;
- old and new source URLs when relocation is proposed;
- group metadata changes;
- counts and article-level lists for added, content-changed,
  metadata-changed, and removed entries;
- a compatibility warning for hashless manifests;
- a destructive warning when removals exist; and
- **Cancel** and **Apply update** actions.

An equal target fingerprint with no pending or failed target downloads produces
an **Already up to date** status instead of an empty confirmation dialog. If the
manifest is current but local content synchronization previously failed, show
that distinction and retain the retry action. During application, reuse
article- and image-level progress reporting. Final messaging distinguishes
complete success, partial success with retryable failures, and a rejected stale
plan.

## Documentation

Update `docs/manifest-format.md` to document:

- the optional `contentHash` syntax and exact-byte semantics;
- stable collection and article ID requirements;
- the distinction between publisher `version` and per-article hashes;
- the legacy fallback and its inability to detect same-URL edits without a
  version change; and
- a deterministic generation workflow in which a script hashes final Markdown
  files and then writes the manifest.

The application help dialog imports that document, so the same content becomes
available in-app without duplicating the schema guide.

## Automated Verification

### Manifest validation and pure diff tests

Add coverage for:

- valid lowercase and uppercase SHA-256 input normalization;
- malformed algorithm prefixes, lengths, and non-hex characters;
- canonical fingerprints that ignore JSON formatting and object-field order;
- fingerprints that reflect resolved URLs, implicit order, metadata, version,
  and hashes;
- added, removed, content-changed, metadata-changed, and unchanged entries;
- URL changes with equal hashes;
- hash introduction or removal for downloaded articles;
- legacy version-change fallback and its no-version-change limitation; and
- group-only metadata changes.

### Database and service tests

Add coverage for:

- v2-to-v3 migration preserving sources, groups, articles, reading states, and
  asset ownership;
- checking a changed manifest without changing the applied fingerprint or
  article records, plus safe fingerprint backfill for an equal migrated source;
- rejecting invalid or changed collection IDs without writes;
- stale-plan rejection;
- automatic download selection based on prior group/article offline state;
- digest verification before content replacement;
- successful content replacement and old unreferenced asset cleanup;
- network, digest, and image failure retaining old content and reading state;
- retrying a failed replacement;
- permanent deletion of article, reading state, favorite, assets, and
  unreferenced image responses;
- last-read and current-article fallback after removal;
- correct offline status with stale but readable content;
- interrupted `downloading` recovery;
- recognizing a newly entered URL with an existing manifest ID;
- confirmed relocation updating `Source.url` without changing `Source.id` or
  creating a duplicate group; and
- cancelling relocation leaving the old URL and collection unchanged.

### UI and regression verification

Use the existing Vitest/jsdom setup to cover dialog summaries, compatibility
and relocation warnings, destructive confirmation text, disabled concurrent
actions, progress, no-update messaging, partial-success messaging, and reader
selection recovery. Verify that applying from continuous mode returns to the
ordinary reader.

Run:

```text
pnpm test
pnpm check
pnpm build
```

Manual checks should include an unchanged hashed manifest, one change of each
classification, a hash mismatch, offline retry, deleting the active favorite,
updating a completely and partially downloaded group, and relocating a source
from a failed old URL through the add-source form.

## Expected Outcome

Manifest collections become durable subscriptions rather than one-time imports.
Publishers can update large collections without forcing complete redownloads,
while users retain predictable control over network access and destructive
removals. Stable IDs preserve reading state for unchanged articles, per-article
hashes make content updates precise, old content provides a safe failure path,
and explicit URL relocation lets a collection move without becoming a duplicate
bookshelf.
