# My MD Reader Agent Guide

## Project Purpose

This repository contains a lightweight offline-first Markdown reader built with Svelte 5, Vite, Dexie, and `vite-plugin-pwa`.

Primary user flows:

- Add a remote Markdown collection from a `manifest.json` URL.
- Download a group of Markdown articles into IndexedDB for offline reading.
- Open a local `.md` file temporarily or import multiple local files into the bookshelf.
- Read cached content, preserve reading progress, and toggle favorites.

## Main Runtime Entry Points

- `src/main.ts`: mounts the Svelte app.
- `src/App.svelte`: top-level state orchestration, bookshelf selection, manifest flow, local import flow, and settings panel visibility.
- `src/components/ReaderPane.svelte`: article rendering, outline extraction, scroll persistence, favorite toggle, temporary-article import action.
- `src/components/Bookshelf.svelte`: group list and bookshelf actions.
- `src/components/GroupDetail.svelte`: article directory, download state, retry state.
- `src/components/AddSourceForm.svelte`: manifest URL input, preview, and save flow.
- `src/components/SettingsPanel.svelte`: theme, font-size, and clear-data actions.

## Data And Service Layer

- `src/lib/content-service.ts`: main application service layer. Handles manifest preview/save, group download, retries, local file import, reading progress persistence, and favorites.
- `src/lib/db.ts`: Dexie schema and IndexedDB tables.
- `src/lib/manifest.ts`: manifest validation and URL resolution helpers.
- `src/lib/markdown.ts`: async Markdown rendering pipeline. Dynamically loads `markdown-it`, `highlight.js`, and `dompurify` so the rendering stack stays out of the initial bundle.
- `src/lib/outline.ts`: extracts headings from rendered article content.
- `src/lib/settings.ts`: local settings persistence and theme application.
- `src/lib/types.ts`: shared app types for groups, articles, previews, settings, and reader state.

## Content Flow

Remote manifest flow:

1. User enters a manifest URL in `AddSourceForm`.
2. `App.svelte` calls `previewManifest` in `content-service.ts`.
3. Manifest data is validated and normalized through `manifest.ts`.
4. Saving persists source, group, and article metadata into Dexie.
5. Download actions fetch article Markdown and store it in IndexedDB.
6. `ReaderPane.svelte` renders cached Markdown into sanitized HTML on demand.

Local file flow:

1. User selects one or more local `.md` files.
2. Single-file selection becomes a temporary in-memory article.
3. Multi-file selection is imported into Dexie as a local group.
4. Temporary articles can be persisted into the bookshelf through the reader UI.

Reading flow:

1. `App.svelte` selects a group and article.
2. The article record is passed into `ReaderPane.svelte`.
3. `ReaderPane.svelte` lazily renders Markdown HTML and extracts headings.
4. Scroll position and favorite state are persisted through `content-service.ts`.

## Build And Test Commands

- Install: `pnpm install`
- Type and Svelte checks: `pnpm check`
- Unit tests: `pnpm test:unit`
- Production build: `pnpm build`
- Local preview: `pnpm preview`
- Dev server: `pnpm dev`

## Performance Notes

- The Markdown rendering stack is intentionally lazy-loaded to keep the startup bundle smaller.
- `vite.config.ts` uses explicit chunk grouping for the Markdown stack, Dexie storage layer, and Svelte runtime.
- If you add heavy reader-only dependencies, keep them behind the same lazy boundary unless they are needed on app startup.

## Editing Guidance

- Prefer changing `content-service.ts` for behavior changes before pushing logic into Svelte components.
- Keep `App.svelte` focused on orchestration; avoid moving storage or parsing logic into it.
- If you change manifest shape or persistence behavior, update tests in `src/lib/*.test.ts`.
- Preserve the raw-Markdown fallback in `ReaderPane.svelte` when render failures happen.
- Avoid reintroducing Playwright unless the project explicitly needs browser automation again.

## Existing Specs

- `docs/superpowers/specs/2026-05-16-md-reader-pwa-design.md`: initial product and architecture spec.
- `docs/superpowers/specs/2026-05-16-bundle-splitting-llm-doc-design.md`: bundle splitting and agent-document spec.
