# MD Reader PWA Design

Date: 2026-05-16

## Goal

Build a personal Markdown reader that works on web, Android, and iOS through a PWA. The first version focuses on lightweight reading and offline access. It supports two content entry paths:

- Remote article groups described by a `manifest.json` URL, mainly for mobile download and offline reading.
- Local `.md` files selected on PC, mainly for quick reading or importing into the local bookshelf.

The first version does not include native app shells, account sync, content management, HTML rendering, or automatic Markdown content updates.

## Scope

In scope:

- PWA app shell with offline availability.
- Bookshelf grouped by article collection.
- Add a remote group from a manifest URL.
- Download a whole group of Markdown articles for offline reading.
- Select local `.md` files on PC and either open them temporarily or import them.
- Render Markdown for reading.
- Save reading progress, recently read article, basic favorite state, theme, and font size.
- Responsive UI: document-reader layout on PC, focused reader layout on mobile.

Out of scope for version 1:

- Rendering saved `.html` files.
- Native Android/iOS shell.
- User accounts or cross-device sync.
- Server-side content management.
- Background download.
- Automatic Markdown content update checks.
- Incremental content update and conflict handling.
- Full offline image download. Remote images may render online; offline asset support is reserved for later.

## Technical Stack

Use a lightweight client-side stack:

- Package manager: `pnpm`.
- Build tool: Vite 8.
- UI framework: Svelte 5 with TypeScript.
- PWA support: `vite-plugin-pwa`.
- Local database: Dexie over IndexedDB.
- Markdown rendering: `markdown-it` or an equivalent framework-agnostic Markdown renderer.
- HTML sanitization: DOMPurify or an equivalent sanitizer before injecting rendered Markdown.
- Code highlighting: `highlight.js` or Shiki, chosen during implementation based on bundle size and rendering quality.
- Unit tests: Vitest.
- Browser tests: Playwright.

Use plain Svelte with Vite for version 1. Do not use SvelteKit unless a later version needs server-side routing, prerendering, or a combined content publishing server.

## Content Model

The reader uses one unified model for remote and local content.

### Source

Represents where content came from.

- `id`: stable local ID.
- `type`: `manifest` or `local`.
- `url`: manifest URL for remote sources.
- `createdAt`.
- `updatedAt`.

### Group

Represents a collection, such as a course, article set, book, or local import batch.

- `id`: stable group ID.
- `sourceId`.
- `title`.
- `description`.
- `version`.
- `articleCount`.
- `offlineStatus`: `not_downloaded`, `partial`, or `downloaded`.
- `lastReadArticleId`.
- `createdAt`.
- `updatedAt`.

### Article

Represents one Markdown article.

- `id`: stable article ID within a group.
- `groupId`.
- `order`.
- `title`.
- `url`: remote article URL when sourced from manifest.
- `content`: Markdown content once downloaded or imported.
- `downloadStatus`: `not_downloaded`, `downloading`, `downloaded`, or `failed`.
- `errorMessage`.
- `createdAt`.
- `updatedAt`.

### ReadingState

Represents local reading state.

- `articleId`.
- `groupId`.
- `scrollPosition` or equivalent progress marker.
- `progressRatio`.
- `isFavorite`.
- `lastReadAt`.

### Asset

Reserved for later image and attachment caching.

- `id`.
- `articleId`.
- `originalUrl`.
- `localCacheKey`.
- `status`.

Version 1 may create the store shape but does not need to implement full asset download.

## Manifest Format

Each remote group is described by one JSON manifest. Article URLs may be relative to the manifest URL.

```json
{
  "schemaVersion": 1,
  "id": "geektime-883",
  "title": "RAG Course",
  "description": "A course article collection",
  "version": "2026-05-16",
  "articles": [
    {
      "id": "806059",
      "order": 1,
      "title": "Opening Notes: RAG for Traditional Developers",
      "url": "articles/001-806059.md"
    }
  ]
}
```

Required fields:

- `schemaVersion`.
- `id`.
- `title`.
- `articles`.
- `articles[].id`.
- `articles[].title`.
- `articles[].url`.

Optional fields:

- `description`.
- `version`.
- `articles[].order`.

If `order` is missing, article order follows the manifest array order.

## Data Flow

### Remote Group Download

1. User opens the add-source screen and enters a manifest URL.
2. App fetches and validates `manifest.json`.
3. App stores the source, group, and article metadata in IndexedDB.
4. User starts whole-group download.
5. App downloads each Markdown file using article URLs resolved relative to the manifest URL.
6. Each successful article is saved to IndexedDB.
7. Failed articles are marked as `failed` with an error message.
8. Group status becomes `downloaded` only when all articles are downloaded; otherwise it becomes `partial`.
9. User can tap continue or retry to download failed articles.

### Local Markdown Open And Import

1. User selects one or more `.md` files on PC.
2. For a single file, the app opens it in the reader as a temporary article.
3. The user can add the temporary article to the bookshelf.
4. For multiple files, the app creates a local import group and stores the files as articles.
5. Local imported articles use the same reader, progress, and bookshelf behavior as remote articles.

### Reading

1. User selects a group and article.
2. App loads Markdown content from IndexedDB or temporary local state.
3. Markdown is rendered in the reading view.
4. Reading position is saved periodically and when leaving the article.
5. Reopening an article restores the last progress marker where possible.

## Offline Behavior

The PWA has two offline layers:

- Service Worker caches the application shell: HTML, JavaScript, CSS, icons, and other static app assets.
- IndexedDB stores content: groups, articles, Markdown bodies, and reading state.

When offline:

- Downloaded articles remain readable.
- Undownloaded remote articles show a message that network access is required.
- Remote images inside Markdown may fail to load in version 1.
- App navigation and settings remain usable.

PWA app updates are supported through Service Worker behavior. Markdown content updates are manual in version 1 and are not checked automatically in the background.

## UI Design

### Bookshelf

Shows local groups such as courses, article sets, and local imports.

Each group displays:

- Title.
- Article count.
- Offline status.
- Recently read article.
- Last read time when available.

Primary actions:

- Open group.
- Add source.
- Import local Markdown.
- Remove local group.

### Add Source

Supports:

- Entering a manifest URL.
- Validating and previewing group metadata.
- Adding the group to the bookshelf.
- Starting whole-group download.

### Group Directory

Shows articles in order with download state and reading state.

Actions:

- Start or continue whole-group download.
- Open any downloaded article.
- Retry failed downloads.

### Reader On PC

Uses a document-reader layout:

- Left pane: group/article navigation.
- Center pane: Markdown content.
- Optional right pane: article heading outline.

This layout favors fast switching and technical reading.

### Reader On Mobile

Uses a focused reading layout:

- Main screen is the article body.
- Top bar provides back, directory, outline, and reading settings actions.
- Directory and settings open as drawer or bottom sheet.

This layout favors long-form reading on small screens.

### Settings

Version 1 settings:

- Theme: light, dark, or system.
- Font size.
- Clear cached content or remove groups.
- App version/update state when available.

## Error Handling

Manifest fetch failure:

- Show a clear message for network, invalid URL, CORS, or invalid JSON errors.

Manifest validation failure:

- Show which required field is missing or malformed.

Article download failure:

- Mark only the failed article as failed.
- Keep successful articles.
- Allow retry or continue download.

Offline access failure:

- If an article is not cached, show that network access is required.

Markdown render failure:

- Fall back to displaying raw Markdown text.

Storage failure:

- Show a storage error and suggest deleting unused groups or browser data.

## Testing Strategy

Unit-level tests:

- Manifest validation.
- Relative URL resolution.
- Group and article ordering.
- Download status transitions.
- Reading progress persistence helpers.

Integration tests:

- Add manifest URL and persist group metadata.
- Download group with all articles succeeding.
- Download group with partial failures and retry.
- Read downloaded article while offline.
- Import local Markdown files.

UI tests:

- PC reader layout with navigation and article content.
- Mobile reader layout with directory/settings drawer.
- Empty bookshelf state.
- Partial download state.
- Offline unavailable article state.

PWA tests:

- Application shell loads offline after first visit.
- New application version can be detected or activated through the Service Worker update path.

## First Implementation Milestone

The first implementation should produce a usable personal reader with:

- PWA shell.
- IndexedDB-backed content store.
- Manifest URL add flow.
- Whole-group Markdown download.
- Bookshelf and group directory.
- Markdown reading view.
- Local `.md` file open/import.
- Reading progress.
- Basic responsive PC/mobile layout.
