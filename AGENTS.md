# My MD Reader Agent Guide

## Project Purpose

Lightweight offline-first Markdown reader built with Svelte 5, Vite 8, Dexie, and `vite-plugin-pwa`.

Primary user flows:

- Add a remote Markdown collection from a `manifest.json` URL.
- Import a single article from a raw `.md` URL.
- Download a group of Markdown articles into IndexedDB for offline reading (including images).
- Open a local `.md` file temporarily, or import multiple local files into the bookshelf.
- Drag-and-drop `.md` files onto the app (desktop only).
- Read cached content with Mermaid diagram support, preserve reading progress, toggle favorites, enter focus mode.

## Architecture

`App.svelte` orchestrates all top-level state and delegates to these layers:

- **Service layer** (`src/lib/content-service.ts`): all persistence, download, retry, and import logic. Prefer changing this file for behavior changes before pushing logic into components.
- **Database** (`src/lib/db.ts`): Dexie schema (currently v2) with tables: `sources`, `groups`, `articles`, `readingStates`, `assets`.
- **Rendering** (`src/lib/markdown.ts`): lazy-loaded pipeline — `markdown-it` + `highlight.js` (selective language imports) + `dompurify` + `mermaid`. All heavy dependencies stay out of the initial bundle.
- **Components**: `ReaderPane`, `Bookshelf`, `GroupDetail`, `AddSourceForm`, `SettingsPanel`, `UpdatePrompt`.

### Offline image caching

When articles are downloaded, `content-service.ts` extracts image URLs from Markdown, fetches blobs into the `assets` table, and rewrites image references to `mdr-asset://` placeholders. On read, `hydrateArticleAssets` converts placeholders to `blob:` object URLs. The asset system has a retry queue with exponential backoff (up to 5 attempts).

### Content flows

**Manifest flow**: `AddSourceForm` → `previewManifest` → validate/normalize → save source + group + articles to Dexie → download articles + assets → render in `ReaderPane`.

**URL flow**: paste a raw `.md` URL → `previewUrlArticle` fetches and extracts title → `saveUrlArticle` persists as a single-article group with downloaded assets.

**Local file flow**: single file becomes a temporary in-memory article; multiple files are imported as a local group. Drag-and-drop uses the same paths via `drop-import.ts`.

**Reading flow**: `App.svelte` selects group/article → `hydrateArticleAssets` resolves offline images → `ReaderPane` renders HTML, extracts headings, renders Mermaid blocks → scroll position and favorites persisted through `content-service.ts`.

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
- Mermaid is separately lazy-loaded only when `pre.mermaid` blocks exist in rendered content.
- `vite.config.ts` uses Vite 8's `rolldownOptions` with explicit chunk groups for the markdown stack, Dexie, and Svelte runtime.
- Workbox runtime-caches mermaid chunks with a `CacheFirst` strategy.
- If you add heavy reader-only dependencies, keep them behind the same lazy boundary.

## Editing Guidance

- Keep `App.svelte` focused on orchestration; avoid moving storage or parsing logic into it.
- If you change manifest shape, persistence behavior, or asset handling, update tests in `src/lib/*.test.ts`.
- Preserve the raw-Markdown fallback in `ReaderPane.svelte` when render failures happen.
- DOMPurify is configured with a custom `ALLOWED_URI_REGEXP` that permits `blob:` URIs for offline images — don't remove that.
- The `assets` table migration (v1→v2) adds `nextRetryAt` and `updatedAt` indexes; new schema changes need a v3 migration in `db.ts`.
- Avoid reintroducing Playwright unless the project explicitly needs browser automation.
- When generating commit messages, use gitmoji.

## Existing Specs

- `docs/superpowers/specs/2026-05-16-md-reader-pwa-design.md`: initial product and architecture spec.
- `docs/superpowers/specs/2026-05-16-bundle-splitting-llm-doc-design.md`: bundle splitting and agent-document spec.
- `docs/superpowers/specs/2026-05-17-deployment-and-nginx-design.md`: deployment and nginx configuration spec.
- `docs/superpowers/specs/2026-05-17-offline-image-caching-design.md`: offline image caching design spec.
