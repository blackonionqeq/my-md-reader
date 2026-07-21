# Continuous Reading Virtualization Implementation Plan

Date: 2026-07-21

Design: `docs/superpowers/specs/2026-07-21-continuous-reading-virtualization-design.md`

## Objective

Implement session-only continuous reading for fully downloaded multi-article
groups. Keep exactly the active article and its immediate neighbors mounted,
preserve stable placeholder geometry, retain article-scoped progress, and ship
the feature implementation behind a Vite dynamic-import boundary.

## Step 1: Pure geometry and heading identity

- Add `src/lib/continuous-reader.ts` with deterministic helpers for render
  windows, median height estimation, anchor selection, within-article progress,
  and height-change compensation.
- Add focused Vitest coverage for collection edges, distant jumps, estimates,
  anchor boundaries, progress clamping, and compensation direction.
- Extend `collectHeadings` with an optional article-specific ID prefix while
  preserving existing IDs for the single reader; cover both behaviors.

## Step 2: Lazy article renderer

- Add `src/components/ContinuousArticle.svelte` inside the feature-only import
  graph.
- Reuse the existing Markdown renderer, highlighting, Mermaid, raw-Markdown
  fallback, outline extraction, and generation guards.
- Accept cached sanitized HTML and report rendered HTML/headings to the pane so
  remounting avoids Markdown parsing.

## Step 3: Virtualized continuous pane

- Add `src/components/ContinuousReaderPane.svelte` with permanent article
  slots and a previous/current/next mount window.
- Hydrate article content only as it enters the window, cache it for the
  session, and render article-scoped failure states without stopping siblings.
- Observe slots with Intersection Observer and Resize Observer, with a
  requestAnimationFrame scroll fallback.
- Measure mounted heights, apply explicit compensation above the reading
  anchor, restore the initial article position once, and support distant jumps.
- Persist active-article progress with debounce and flush it on boundary change,
  exit, and teardown.
- Delegate image clicks and image-failure handling while preserving the normal
  Cache Storage URL path.

## Step 4: Application integration

- Add an enabled/disabled continuous-reading action to `GroupDetail.svelte`.
- Keep `App.svelte` as the owner of transient reader mode, lazy module state,
  active article selection, outline synchronization, directory jumps, and
  ordinary-reader exit.
- Dynamically import the pane only after an enabled user action. Do not add any
  static imports or preloads for feature-private files.
- Exit continuous mode on group changes, reload, and explicit exit. Do not
  persist the mode.
- Route left/right article navigation and outline clicks through the pane while
  continuous mode is active.

## Step 5: Verification and bundle contract

- Add deterministic observer fakes and component/application regression tests
  where the current Vitest/jsdom setup can exercise behavior reliably.
- Run `pnpm test`, `pnpm check`, and `pnpm build`.
- Inspect `dist` to confirm a recognizable async continuous-reader JavaScript
  chunk and associated async CSS, with no static main-entry import edge.
- Compare the main-entry gzip size against the pre-implementation baseline from
  commit `4821b81`; the permitted increase is at most 1 KiB.
- Commit the implementation with a gitmoji message after all checks pass.

Baseline production build at `4821b81` with the installed Vite 8.0.13
toolchain: `dist/assets/index-35ZE9fCc.js`, 57,363 bytes raw and 18,934 bytes
through Node's `gzipSync` defaults.
