# Bundle Splitting And LLM Project Doc Design

Date: 2026-05-16

## Goal

Reduce the initial browser bundle for the Markdown reader without changing user-visible behavior, and add a concise project document optimized for large language models working in the repository.

## Scope

In scope:

- Move the Markdown rendering stack off the initial synchronous bundle.
- Split production chunks so large third-party dependencies are isolated from the main application entry.
- Add one repository document that explains structure, runtime flow, and modification entry points for LLM agents.

Out of scope:

- Replacing Markdown or syntax-highlighting libraries.
- Refactoring application state or IndexedDB behavior.
- Changing app UX, styling, or data model.
- Adding new browser automation or test frameworks.

## Approach

### 1. Lazy-load Markdown Rendering

The reader currently imports `markdown-it`, `highlight.js`, and `dompurify` synchronously through `src/lib/markdown.ts`, which makes the reading stack part of the initial application chunk. This is unnecessary because the app can render its shell, bookshelf, settings, and metadata views before any article body is opened.

The implementation will convert Markdown rendering to an async boundary:

- `src/lib/markdown.ts` will expose an async render function that dynamically imports `markdown-it`, `highlight.js`, and `dompurify`.
- The renderer instance will be cached after the first load so subsequent article opens remain fast.
- `src/components/ReaderPane.svelte` will await that async renderer and ignore stale results if the user switches articles while the rendering stack is still loading.

This keeps article rendering behavior intact while removing the rendering toolchain from the main startup path.

### 2. Manual Chunking In Vite

Lazy loading alone should reduce the entry chunk, but the production build should also separate stable dependency groups so cache behavior is better and future growth is easier to reason about.

`vite.config.ts` will add `build.rollupOptions.output.manualChunks` with conservative groups:

- `markdown-stack`: `markdown-it`, `highlight.js`, `dompurify`
- `storage-stack`: `dexie`
- `vendor-svelte`: Svelte runtime and adjacent framework runtime modules

The chunking rule will stay small and explicit. This is a performance-oriented packaging change, not an architectural abstraction.

### 3. Root-Level Agent Document

Add one root-level `AGENTS.md` document that is written for machine collaborators rather than end users. It should answer:

- What the app is for.
- Which files control the main app shell, reader, storage, settings, and manifest flow.
- How content moves from manifest/local file into IndexedDB and then into the reader.
- Which commands to run for install, check, test, and build.
- What constraints matter when editing this repo.

The document will favor short sections, stable file references, and direct modification guidance over narrative explanation.

## File-Level Changes

- `src/lib/markdown.ts`: replace synchronous module initialization with cached async loading.
- `src/components/ReaderPane.svelte`: update render flow to handle async HTML generation safely.
- `vite.config.ts`: add explicit Rollup chunk splitting.
- `AGENTS.md`: add the machine-oriented project guide at the repository root.

## Error Handling

- If lazy loading or Markdown rendering fails, the reader must keep the current fallback behavior of showing raw Markdown content.
- If multiple render requests overlap, only the latest request should win.
- If the renderer dependencies load slowly, the app may briefly show the existing empty state or prior content, but it must not throw or corrupt scroll restoration.

## Validation

- `pnpm check`
- `pnpm test:unit`
- `pnpm build`
- Confirm the build output shows a smaller main application chunk and isolates the Markdown/rendering dependencies into separate assets.

## Expected Outcome

The app keeps the same features, but the startup bundle becomes smaller and more cache-friendly. The repo also gains one high-signal orientation document that lets another LLM find the correct files and workflows quickly.
