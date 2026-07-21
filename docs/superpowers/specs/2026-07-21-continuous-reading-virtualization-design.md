# Continuous Reading Virtualization Design

Date: 2026-07-21

## Goal

Add an optional continuous-reading mode that presents every Markdown article in
the selected bookshelf as one scrollable reading surface while keeping only the
previous, current, and next articles mounted as full DOM. Articles outside that
three-article window retain lightweight slots and height placeholders so users
can scroll in either direction without losing their position.

The mode is intended for occasional reading of collections that typically
contain 20–30 articles of roughly 20 KB each. It complements rather than
replaces the existing single-article reader.

## Success Criteria

- A fully downloaded bookshelf with at least two articles can enter continuous
  reading from its directory.
- Continuous reading starts at the currently selected article and restores that
  article's saved within-article scroll position.
- At most the previous, current, and next articles have rendered Markdown DOM
  at one time; first and last articles therefore produce a two-article window.
- Scrolling across an article boundary mounts the new adjacent article and
  unmounts the article that is now two positions away.
- Unmounted articles retain measured-height placeholders and do not cause a
  visible scroll jump when they mount or unmount.
- The article crossing a reading anchor 25% below the viewport top becomes the
  current article and drives directory highlighting, outline content, keyboard
  navigation, and `lastReadArticleId`.
- Progress remains compatible with the existing per-article `readingStates`
  records; no Dexie schema migration is required.
- The mode is session-only. It is never stored in IndexedDB or local storage,
  and leaving the mode, changing bookshelf, reloading, or restarting returns to
  single-article reading.
- Single-article reading, Markdown fallback, offline images, focus mode, and
  existing progress restoration continue to work.

## Non-Goals

- Combining the Markdown source into one persisted article.
- Paragraph-level, heading-level, or pixel-level virtualization.
- Automatically downloading missing articles while the user scrolls.
- Persisting a preferred reading mode globally or per bookshelf.
- Adding an article-count limit. The entry remains available for collections
  larger than 30 articles when their content is fully downloaded.
- Replacing the existing single-article `ReaderPane`.
- Adding a browser-automation framework.

## Availability And Entry

Add a **Continuous reading** action to the group directory beside the existing
download actions. The action is enabled only when:

- the selected group has at least two articles; and
- `group.offlineStatus === 'downloaded'`.

If the group is not completely downloaded, keep the action visible but disabled
and explain that all articles must be downloaded first. This prevents the first
version from coupling virtual scrolling to network downloads and partial-group
error recovery.

The entry uses the currently selected article as its initial article. If no
article is selected, use the group's `lastReadArticleId`, then its first article
as the fallback. Continuous mode has a group-level header with the group title
and an explicit **Exit continuous reading** action. Exiting flushes progress and
opens the active article in the ordinary reader at the same within-article
position.

Changing groups always exits continuous mode before selecting the new group.
Reloading naturally initializes the in-memory mode to `single`.

## State And Ownership

`App.svelte` remains the orchestrator and owns these transient values:

```ts
type ReaderMode = 'single' | 'continuous';

let readerMode: ReaderMode = 'single';
let continuousTargetArticleId: string | null = null;
```

`selectedArticleId` continues to identify the active article in both modes.
The continuous reader reports active-article changes to `App.svelte`, which
updates directory selection, the displayed outline, and the existing last-read
metadata. The mode itself is not passed to the settings layer.

Content remains stored as separate `Article` records. The service layer keeps
responsibility for IndexedDB access, image-cache hydration, retry state, and
progress persistence. Continuous-reader components request hydrated content
only for articles entering the three-article render window.

## Component Boundaries

### `ContinuousReaderPane.svelte`

Owns the continuous scroll surface and session-scoped virtualization state:

- ordered article slots;
- active article index;
- render-window membership;
- estimated and measured heights;
- the Markdown HTML and outline cache for this continuous-reading session;
- scroll-root selection for desktop and mobile;
- active-article observation and height observation;
- progress scheduling and flushes;
- delegated image clicks and image-error reporting; and
- cleanup of observers, listeners, timers, stale async work, and the lazy image
  viewer.

It exposes callbacks for active-article, outline, progress, and image-error
changes. A target-article input allows `App.svelte` to turn directory clicks and
left/right navigation into continuous-reader jumps.

### `ContinuousArticle.svelte`

Owns rendering for one mounted article. It receives hydrated Markdown or a
cached sanitized HTML string, renders through the existing lazy Markdown stack,
then runs code highlighting and Mermaid rendering. It reports headings, render
completion, and failures to its parent. The pane observes the stable outer slot
for height changes so measurement survives body replacement.

The component retains the existing raw-Markdown fallback. Async work uses a
request generation or cancellation flag so a result from an article that has
already left the render window cannot mutate the replacement component. Svelte
lifecycle cleanup is registered synchronously and performs all teardown when a
keyed article instance is destroyed.

### `continuous-reader.ts`

Contains DOM-independent, unit-testable decisions:

- the render window for an active index;
- height estimation from measured samples;
- article selection around the 25% reading anchor;
- within-article scroll offset and progress calculations; and
- scroll compensation when a slot above the anchor changes height.

This separation keeps geometry rules deterministic and prevents
`ContinuousReaderPane.svelte` from accumulating unrelated business logic.

### Existing modules

- `ReaderPane.svelte` remains the single-article implementation.
- `markdown.ts` remains the shared Markdown, syntax-highlighting, sanitization,
  and Mermaid boundary.
- `content-service.ts` remains the persistence and hydration boundary. If
  needed, add a focused function that loads and hydrates one article by ID
  instead of moving database access into a component.
- `outline.ts` accepts an optional article-specific ID prefix so headings from
  separate mounted articles cannot collide. Existing callers preserve their
  current IDs when no prefix is provided.

## Virtual Slot Model

Every article has one permanent lightweight `<section>` slot in manifest order.
A slot records:

```ts
type ContinuousArticleSlot = {
  articleId: string;
  index: number;
  measuredHeight?: number;
  estimatedHeight: number;
};
```

Only indexes returned by the render-window calculation are mounted:

```text
activeIndex - 1, activeIndex, activeIndex + 1
```

Indexes outside the collection are omitted. All other slots contain no article
body and use an explicit placeholder height. A previously mounted slot uses its
last measured height. An unmeasured slot uses the median of available measured
heights, falling back to a conservative viewport-based initial estimate when no
measurements exist.

The slot element itself survives body mounting and unmounting. This allows the
observer to track all 20–30 positions while the expensive Markdown DOM remains
bounded to three articles.

## Active Article And Window Movement

The reading anchor is a horizontal position 25% below the active scroll root's
top edge. The slot containing that anchor is current. Intersection Observer
tracks the slots relative to the correct root and schedules active-slot
evaluation asynchronously; the geometry decision remains a pure calculation so
it can also run after programmatic jumps and serve as a fallback.

- Desktop uses the height-constrained continuous reader element as `root`.
- Mobile uses the top-level viewport (`root: null`) because the page itself
  scrolls at the existing 900 px layout breakpoint.

When the anchor moves from article N to article N+1, the render window changes
from N-1/N/N+1 to N/N+1/N+2. The old N-1 body is destroyed only after its latest
height and outgoing progress are captured. The same rule applies in reverse.

Dragging the scrollbar or choosing a distant directory item may skip several
slots. In that case, replace the complete render window with the target's
previous/current/next window rather than mounting intermediate articles.

If Intersection Observer is unavailable, a requestAnimationFrame-throttled
scroll and resize listener performs the same anchor calculation. The fallback
still mounts only the three-article window.

## Height Measurement And Scroll Stability

Resize Observer measures each mounted article slot after Markdown rendering and
continues to observe it because image decode, syntax highlighting, Mermaid, and
responsive layout may change its height later.

When a slot's height changes:

1. Store the new measured height.
2. Keep the slot at that height after its body is unmounted.
3. If the slot is entirely above the reading anchor, adjust the active scroll
   root by the same height delta.
4. Apply no compensation for a slot below the anchor.

Desktop compensation updates the reader element's `scrollTop`; mobile
compensation uses `window.scrollBy(0, delta)`. The virtual scroll surface disables
native overflow anchoring where supported so browser anchoring and explicit
compensation do not both apply the same correction.

Measurement changes are coalesced into an animation frame. The active article
and render window are re-evaluated after compensation, preventing stale observer
entries from immediately reversing the window.

## Initial Position And Programmatic Navigation

Entering continuous mode follows this order:

1. Build all lightweight slots.
2. Load the initial article's existing `ReadingState`.
3. Mount the initial previous/current/next window.
4. Wait for the current article body to render and receive its first stable
   measurement.
5. Align the current slot to the scroll-root top.
6. Add the saved `scrollPosition` within that article.
7. Enable active-article observation and progress persistence.

Progress writes remain suppressed until step 7 so initialization cannot replace
the saved state with zero or an estimated position.

A group-directory click sets `continuousTargetArticleId`. The pane mounts the
target window, waits for the target's first measurement, and scrolls to its
start. A current-article outline click scrolls to the prefixed heading inside
the mounted article. Headings use an article-ID-derived prefix plus their local
heading index so equal headings in adjacent articles remain unique.

Left and right arrow keys retain their previous/next meaning but scroll to the
previous or next article while continuous mode is active. Editable controls
keep the existing keyboard exclusion.

## Progress Semantics

Reading progress remains article-scoped. No group-wide progress record is
introduced.

For the article containing the 25% anchor:

- `scrollPosition` is the non-negative distance from the article slot's top to
  the scroll-root viewport top;
- `progressRatio` is that position divided by the article's usable scroll
  extent and clamped to `[0, 1]`; and
- `lastReadArticleId` is the active article ID.

Persist progress on the existing short debounce while scrolling, and always
flush the outgoing article before an active-article change, window destruction,
mode exit, or component teardown. Do not apply a saved position merely because
the reader naturally scrolls back into an article; saved-position restoration
occurs only on initial entry. This avoids unexpected jumps during continuous
reading.

Continuous progress writes should not reload every group and reading-state
record on each scroll event. Persist through `content-service.ts`, update the
active in-memory metadata directly, and refresh aggregate group data on an
active-article boundary or mode exit.

## Outline And Article Boundaries

Each mounted article displays its manifest order, title, and a visible divider.
This preserves orientation in a long collection and makes the boundary clear
without requiring a separate navigation action.

The right-hand outline displays headings for the active article only. A
session-scoped outline cache lets it update immediately when returning to an
article whose DOM was previously removed. If headings are not yet available,
show the existing empty-outline state until rendering completes.

The group directory continues to display the full collection. Its selected row
follows the active article without calling the single-reader `openArticle`
path. Directory auto-scroll remains limited to keeping the selected row visible.

## Markdown, Images, And Cached Render Results

Article hydration occurs when an article enters the three-item window, not for
the entire collection. This preserves the existing Cache Storage contract:
persisted `mdr-asset://` placeholders become normal absolute HTTP(S) image URLs,
and the service worker serves cached responses.

For the lifetime of one continuous-reading session, keep a map keyed by article
ID containing hydrated content, sanitized HTML, and collected headings. When an
article remounts, reuse sanitized HTML instead of parsing Markdown again. The new
DOM still runs syntax highlighting and Mermaid because those operations decorate
live nodes.

Image clicks are delegated from the continuous pane. The lazily imported
`luma-peek` viewer receives images from the currently mounted window and is
destroyed when the mode exits. Captured image errors identify their owning
article and use the existing `recordArticleImageFailure` path.

## Failure Handling

- If a group becomes partial between rendering the directory and entering the
  mode, re-check availability and remain in single mode with a concise download
  message.
- If an article says `downloaded` but its content is absent, keep its measured
  or estimated slot height and show an article-scoped inconsistency card. Other
  articles remain readable.
- If asset hydration fails, report the article-scoped error and render the
  available Markdown without allowing a stale promise to update an unmounted
  component.
- If Markdown rendering fails, show the raw Markdown fallback used by
  `ReaderPane.svelte`.
- If Mermaid rendering fails, preserve the rest of the article and report the
  block-level failure rather than rejecting the complete continuous pane.
- Image failures use the existing online/offline diagnostic path.
- An extreme measured-height correction preserves the reading anchor rather
  than animating the correction; correctness takes priority over smooth
  scrolling in this recovery case.

## Lifecycle Cleanup

Svelte lifecycle registration must remain synchronous so cleanup functions are
installed before any asynchronous hydration or rendering resolves. Destroying
the pane or a keyed article instance:

- disconnects Intersection Observer and Resize Observer registrations;
- removes manual scroll/resize fallback listeners;
- cancels animation frames and progress timers;
- invalidates outstanding hydration and render generations;
- flushes valid pending progress once;
- destroys the image viewer; and
- releases the session HTML, outline, and height caches when leaving the mode.

## Accessibility

- The continuous mode and exit controls use buttons with explicit accessible
  names and disabled-state explanations.
- Each article slot is a labelled `<section>` with a visible heading.
- Programmatic directory and keyboard jumps move scroll position without
  forcibly moving keyboard focus into article content.
- A mode-change status message announces entry and exit through the existing
  application messaging region.
- Reduced-motion preferences suppress smooth scrolling for programmatic jumps.

## Automated Verification

### Pure logic tests

Add `continuous-reader.test.ts` coverage for:

- render windows at the beginning, middle, and end of a collection;
- a distant target replacing the whole window;
- height estimation with zero, one, and multiple samples;
- positive and negative scroll compensation above the anchor;
- no compensation below the anchor;
- active-slot selection at boundaries; and
- within-article scroll and progress calculations.

### Component tests

Use jsdom with deterministic Intersection Observer and Resize Observer fakes to
verify:

- no more than three article bodies are mounted;
- crossing forward and backward boundaries moves the window correctly;
- entering restores the selected article's saved position;
- directory jumps mount the target window before scrolling;
- current article, directory highlight, and outline stay synchronized;
- height changes above the anchor preserve the visual position;
- stale hydration and render results are ignored;
- a failed article renders its local fallback without affecting siblings; and
- destroying the pane removes observers, tasks, listeners, and viewer state.

Svelte 5 component tests account for asynchronous mounting and flush rendering
before assertions.

### Application regression tests

Cover availability gating, non-persistence, group-change exit, ordinary exit to
the active single article, continuous-mode arrow navigation, and unchanged
single-reader behavior. Preserve existing content-service and image-cache tests.

Run:

```text
pnpm test
pnpm check
pnpm build
```

No Playwright or other browser-automation dependency is added. Manual desktop
and mobile checks should include forward scrolling, reverse scrolling,
scrollbar dragging to a distant article, directory and outline jumps, focus
mode, offline images, and returning to single mode.

## Expected Outcome

Users can opt into a book-like continuous reading session without combining or
duplicating persisted Markdown. The scroll surface feels continuous while the
expensive DOM remains strictly bounded to the current article and its two
neighbors. Existing article progress, offline storage, and single-reader flows
remain the source of truth, keeping the feature isolated and reversible.
