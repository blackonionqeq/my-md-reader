# My MD Reader Agent Guide

## Project Purpose

Lightweight offline-first Markdown reader built with Svelte 5, Vite 8, Dexie, and `vite-plugin-pwa`.

Primary user flows:

- Add a remote Markdown collection from a `manifest.json` URL.
- Import a single article from a raw `.md` URL.
- Download a group of Markdown articles for offline reading: article content and image metadata live in IndexedDB, while image responses live in Cache Storage.
- Open a local `.md` file temporarily, or import multiple local files into the bookshelf.
- Drag-and-drop `.md` files onto the app (desktop only).
- Read cached content with Mermaid diagram support, preserve reading progress, toggle favorites, enter focus mode.
- Navigate between articles with previous/next buttons or left/right arrow keys.
- Browse article outline (table of contents extracted from headings) in the sidebar.
- Resume where you left off — last-opened article and scroll position restore on launch.
- Open `.md` files directly from the desktop OS via PWA file handling.

## Architecture

`App.svelte` orchestrates all top-level state and delegates to these layers:

- **Service layer** (`src/lib/content-service.ts`): all persistence, download, retry, and import logic. Prefer changing this file for behavior changes before pushing logic into components.
- **Database** (`src/lib/db.ts`): Dexie schema (currently v2) with tables: `sources`, `groups`, `articles`, `readingStates`, `assets`.
- **Image cache** (`src/lib/image-cache.ts`, `src/lib/image-cache-contract.ts`): Cache Storage reads/writes, image request and response validation, legacy Blob migration, cache cleanup, and the shared versioned cache name used by Workbox.
- **Rendering** (`src/lib/markdown.ts`): lazy-loaded pipeline — `markdown-it` + `highlight.js` (selective language imports) + `dompurify` + `mermaid`. All heavy dependencies stay out of the initial bundle.
- **Components**: `ReaderPane`, `Bookshelf`, `GroupDetail`, `AddSourceForm`, `SettingsPanel`, `UpdatePrompt`, `ManifestHelpDialog`.
- **Utilities**: `focus-mode.ts` (fullscreen focus mode with F11 shortcut), `outline.ts` (heading extraction for ToC sidebar), `reader-scroll.ts` (scroll position resolution on article open), `settings.ts` (theme/font/last-opened persistence via localStorage), `format.ts` (relative time and status labels), `id.ts` (prefixed ID generation), `drop-import.ts` (drag-and-drop file handling).
- **Image viewer**: `luma-peek` is lazy-loaded in `ReaderPane` for inline image viewing.

### Offline image caching

When articles are downloaded, `content-service.ts` extracts image URLs from Markdown, stores verified image responses in the versioned `md-reader-images-v1` Cache Storage cache, records ownership and retry metadata in the Dexie `assets` table, and persists successful references as `mdr-asset://` placeholders. On read, `hydrateArticleAssets` ensures each image is cached and converts its placeholder back to the original absolute HTTP(S) URL; the Workbox `CacheFirst` image route serves that request from Cache Storage. Legacy IndexedDB Blob payloads are migrated incrementally and removed only after the cache write is verified and the service worker controls the page. The asset system retries failed downloads with increasing backoff, up to 5 attempts.

### Content flows

**Manifest flow**: `AddSourceForm` → `previewManifest` → validate/normalize → save source + group + articles to Dexie → download articles + assets → render in `ReaderPane`.

**URL flow**: paste a raw `.md` URL → `previewUrlArticle` fetches and extracts title → `saveUrlArticle` persists as a single-article group with downloaded assets.

**Local file flow**: single file becomes a temporary in-memory article; multiple files are imported as a local group. Drag-and-drop uses the same paths via `drop-import.ts`.

**Reading flow**: `App.svelte` selects group/article → `hydrateArticleAssets` resolves offline images → `ReaderPane` renders HTML, extracts headings, renders Mermaid blocks → scroll position and favorites persisted through `content-service.ts`. On launch, `settings.ts` restores the last-opened group/article and scroll position.

**Download progress**: `downloadGroup` accepts an `onProgress` callback reporting article-level and image-level progress. The UI shows real-time progress with a mobile toast.

**Theme system**: `settings.ts` manages light/dark/system theme modes. `applyTheme` sets the `data-theme` attribute and dynamically updates the `<meta name="theme-color">` tag (including listening for `prefers-color-scheme` changes in system mode).

## Build and Test Commands

- Install: `pnpm install`
- Dev server: `pnpm dev`
- Production build: `pnpm build`
- Type and Svelte checks: `pnpm check`
- All tests: `pnpm test` or `pnpm test:unit`
- Single test file: `pnpm test -- src/lib/manifest.test.ts`
- Tests use vitest with jsdom environment and `fake-indexeddb`.

## Performance Notes

- The Markdown rendering stack (`markdown-it`, `highlight.js`, `dompurify`) is intentionally lazy-loaded via dynamic imports.
- Syntax highlighting is deferred — markdown renders immediately, then highlighting applies progressively. Supported languages: bash, go, javascript, json, markdown, plaintext, python, rust, sql, typescript, xml, yaml.
- Mermaid is separately lazy-loaded only when `pre.mermaid` blocks exist in rendered content.
- `luma-peek` (image viewer) is lazy-loaded in `ReaderPane` only when an image is clicked.
- `vite.config.ts` uses Vite 8's `rolldownOptions` with explicit chunk groups for the markdown stack, Dexie, and Svelte runtime.
- Workbox runtime-caches image requests in `md-reader-images-v1` with a `CacheFirst` strategy; application code pre-fills the same cache during explicit downloads.
- Workbox runtime-caches mermaid chunks with a `CacheFirst` strategy.
- The PWA manifest uses `display: 'fullscreen'` with `display_override: ['fullscreen', 'standalone']` and registers a `file_handlers` entry for `.md` files.
- If you add heavy reader-only dependencies, keep them behind the same lazy boundary.

## Editing Guidance

- Keep `App.svelte` focused on orchestration; avoid moving storage or parsing logic into it.
- If you change manifest shape, persistence behavior, or asset handling, update tests in `src/lib/*.test.ts`.
- Preserve the raw-Markdown fallback in `ReaderPane.svelte` when render failures happen.
- Offline images render through normal HTTP(S) URLs backed by Cache Storage; do not reintroduce Blob/object-URL delivery for the normal read path. DOMPurify still permits `blob:` URIs for compatibility, but offline image delivery must not depend on them.
- The `assets` table migration (v1→v2) adds `nextRetryAt` and `updatedAt` indexes; new schema changes need a v3 migration in `db.ts`.
- Avoid reintroducing Playwright unless the project explicitly needs browser automation.
- When generating commit messages, use gitmoji.

## Existing Specs

- `docs/superpowers/specs/2026-05-16-md-reader-pwa-design.md`: initial product and architecture spec.
- `docs/superpowers/specs/2026-05-16-bundle-splitting-llm-doc-design.md`: bundle splitting and agent-document spec.
- `docs/superpowers/specs/2026-05-17-deployment-and-nginx-design.md`: deployment and nginx configuration spec.
- `docs/superpowers/specs/2026-05-17-offline-image-caching-design.md`: offline image caching design spec.
- `docs/superpowers/specs/2026-07-16-cache-storage-image-migration-design.md`: current Cache Storage image delivery and legacy Blob migration design.
