<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Viewer } from 'luma-peek';
  import ContinuousArticle from './ContinuousArticle.svelte';
  import {
    calculateArticleProgress,
    calculateHeightCompensation,
    estimateSlotHeight,
    getRenderWindow,
    selectActiveSlot
  } from '../lib/continuous-reader';
  import { hydrateArticleAssets, loadReadingState } from '../lib/content-service';
  import type { Article, Group, OutlineHeading } from '../lib/types';

  type ProgressPayload = {
    articleId: string;
    groupId: string;
    scrollPosition: number;
    progressRatio: number;
  };

  type CachedArticle = {
    article?: Article;
    html?: string;
    headings: OutlineHeading[];
    error?: string;
    loading?: Promise<void>;
  };

  export let group: Group;
  export let articles: Article[];
  export let initialArticleId: string;
  export let targetArticleId: string | null = null;
  export let fontSize = 18;
  export let online = true;
  export let onActiveArticleChange: (articleId: string) => void = () => {};
  export let onOutlineChange: (headings: OutlineHeading[]) => void = () => {};
  export let onSaveProgress: (payload: ProgressPayload) => Promise<void> | void = () => {};
  export let onImageError: (payload: { articleId: string; src: string; reason: string }) => void = () => {};
  export let onExit: (articleId: string) => Promise<void> | void = () => {};

  const requestedInitialIndex = articles.findIndex((article) => article.id === initialArticleId);
  let activeIndex = requestedInitialIndex >= 0 ? requestedInitialIndex : 0;
  let renderIndexes: number[] = [];
  let surface: HTMLElement | null = null;
  let slotElements = new Map<number, HTMLElement>();
  let measuredHeights = new Map<number, number>();
  let articleCache = new Map<string, CachedArticle>();
  let intersectionObserver: IntersectionObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let evaluationFrame = 0;
  let measurementFrame = 0;
  let progressTimer: number | undefined;
  let imageViewer: Viewer | null = null;
  let disposed = false;
  let initialized = false;
  let progressDirty = false;
  let lastHandledTarget = initialArticleId;
  let pendingJump: { articleId: string; offset: number } | null = null;
  let pendingMeasurements = new Map<number, number>();

  $: renderIndexes = getRenderWindow(activeIndex, articles.length);
  $: void renderIndexes, ensureRenderWindow();
  $: if (targetArticleId && targetArticleId !== lastHandledTarget) {
    lastHandledTarget = targetArticleId;
    void jumpToArticle(targetArticleId);
  }

  function usesWindowScroll(): boolean {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function viewportHeight(): number {
    return usesWindowScroll() ? window.innerHeight : (surface?.clientHeight ?? window.innerHeight);
  }

  function estimatedHeight(): number {
    return estimateSlotHeight(measuredHeights.values(), viewportHeight());
  }

  function registerSlot(node: HTMLElement, index: number): { destroy: () => void } {
    slotElements.set(index, node);
    intersectionObserver?.observe(node);
    resizeObserver?.observe(node);

    return {
      destroy() {
        intersectionObserver?.unobserve(node);
        resizeObserver?.unobserve(node);
        slotElements.delete(index);
      }
    };
  }

  function ensureRenderWindow(): void {
    for (const index of renderIndexes) {
      const article = articles[index];
      if (article) {
        void ensureArticle(article);
      }
    }
  }

  async function ensureArticle(article: Article): Promise<void> {
    const existing = articleCache.get(article.id);
    if (existing?.article || existing?.loading || existing?.error) {
      return existing?.loading;
    }

    const entry: CachedArticle = { headings: [] };
    const loading = hydrateArticleAssets(article)
      .then((hydrated) => {
        if (disposed) return;
        if (!hydrated.content) {
          throw new Error('Downloaded article content is missing from local storage.');
        }
        articleCache.set(article.id, { ...entry, article: hydrated, loading: undefined });
        articleCache = new Map(articleCache);
      })
      .catch((error) => {
        if (disposed) return;
        articleCache.set(article.id, {
          headings: [],
          error: error instanceof Error ? error.message : 'Article hydration failed.'
        });
        articleCache = new Map(articleCache);
      });

    entry.loading = loading;
    articleCache.set(article.id, entry);
    articleCache = new Map(articleCache);
    return loading;
  }

  function handleRendered(result: {
    articleId: string;
    html: string;
    headings: OutlineHeading[];
  }): void {
    const current = articleCache.get(result.articleId);
    if (!current || current.error || disposed) return;

    articleCache.set(result.articleId, {
      ...current,
      html: result.html,
      headings: result.headings
    });
    articleCache = new Map(articleCache);

    if (articles[activeIndex]?.id === result.articleId) {
      onOutlineChange(result.headings);
    }
    if (pendingJump?.articleId === result.articleId) {
      schedulePendingJump();
    }
  }

  function getAnchorY(): number {
    if (usesWindowScroll() || !surface) {
      return window.innerHeight * 0.25;
    }
    const rect = surface.getBoundingClientRect();
    return rect.top + surface.clientHeight * 0.25;
  }

  function scheduleEvaluation(): void {
    if (!initialized || evaluationFrame) return;
    evaluationFrame = window.requestAnimationFrame(() => {
      evaluationFrame = 0;
      evaluateActiveSlot();
    });
  }

  function evaluateActiveSlot(): void {
    if (!initialized) return;
    const rects = Array.from(slotElements, ([index, element]) => {
      const rect = element.getBoundingClientRect();
      return { index, top: rect.top, bottom: rect.bottom };
    });
    const nextIndex = selectActiveSlot(rects, getAnchorY());
    if (nextIndex != null && nextIndex !== activeIndex) {
      setActiveIndex(nextIndex);
    }
  }

  function progressFor(index: number): ProgressPayload | null {
    const article = articles[index];
    const slot = slotElements.get(index);
    if (!article || !slot || !surface) return null;

    const rect = slot.getBoundingClientRect();
    const windowScroll = usesWindowScroll();
    const viewportTop = windowScroll ? window.scrollY : surface.scrollTop;
    const slotTop = windowScroll
      ? rect.top + window.scrollY
      : rect.top - surface.getBoundingClientRect().top + surface.scrollTop;
    const height = measuredHeights.get(index) ?? rect.height;
    return {
      articleId: article.id,
      groupId: article.groupId,
      ...calculateArticleProgress({
        slotTop,
        slotHeight: height,
        viewportTop,
        viewportHeight: viewportHeight()
      })
    };
  }

  function persistIndex(index: number): void {
    const payload = progressFor(index);
    if (payload) {
      void onSaveProgress(payload);
    }
  }

  function setActiveIndex(nextIndex: number): void {
    if (nextIndex < 0 || nextIndex >= articles.length || nextIndex === activeIndex) return;
    persistIndex(activeIndex);
    progressDirty = false;
    activeIndex = nextIndex;
    const article = articles[nextIndex]!;
    onActiveArticleChange(article.id);
    onOutlineChange(articleCache.get(article.id)?.headings ?? []);
  }

  function handleScroll(): void {
    if (!initialized) return;
    progressDirty = true;
    scheduleEvaluation();
    if (progressTimer) window.clearTimeout(progressTimer);
    progressTimer = window.setTimeout(() => {
      progressTimer = undefined;
      void flushProgress();
    }, 200);
  }

  export async function flushProgress(): Promise<void> {
    if (progressTimer) {
      window.clearTimeout(progressTimer);
      progressTimer = undefined;
    }
    if (!initialized || !progressDirty) return;
    progressDirty = false;
    const payload = progressFor(activeIndex);
    if (payload) {
      await onSaveProgress(payload);
    }
  }

  function handleResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      const index = Number((entry.target as HTMLElement).dataset.index);
      if (!renderIndexes.includes(index)) continue;
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      if (height > 0) pendingMeasurements.set(index, height);
    }

    if (measurementFrame || pendingMeasurements.size === 0) return;
    measurementFrame = window.requestAnimationFrame(() => {
      measurementFrame = 0;
      const anchorY = getAnchorY();
      let compensation = 0;
      for (const [index, nextHeight] of pendingMeasurements) {
        const element = slotElements.get(index);
        if (!element) continue;
        const previousHeight = measuredHeights.get(index) ?? nextHeight;
        compensation += calculateHeightCompensation({
          slotTop: element.getBoundingClientRect().top,
          previousHeight,
          nextHeight,
          anchorY
        });
        measuredHeights.set(index, nextHeight);
      }
      pendingMeasurements.clear();
      measuredHeights = new Map(measuredHeights);

      if (initialized && compensation !== 0) {
        if (usesWindowScroll()) window.scrollBy(0, compensation);
        else if (surface) surface.scrollTop += compensation;
      }
      scheduleEvaluation();
    });
  }

  function scrollToSlot(articleId: string, offset: number): void {
    const index = articles.findIndex((article) => article.id === articleId);
    const slot = slotElements.get(index);
    if (!slot || !surface) return;

    const rect = slot.getBoundingClientRect();
    if (usesWindowScroll()) {
      window.scrollTo(0, rect.top + window.scrollY + offset);
    } else {
      const rootRect = surface.getBoundingClientRect();
      surface.scrollTop += rect.top - rootRect.top + offset;
    }
    pendingJump = null;
    initialized = true;
    progressDirty = false;
    scheduleEvaluation();
  }

  function schedulePendingJump(): void {
    if (!pendingJump) return;
    const jump = pendingJump;
    window.requestAnimationFrame(() => {
      if (!disposed && pendingJump === jump) {
        scrollToSlot(jump.articleId, jump.offset);
      }
    });
  }

  export async function jumpToArticle(articleId: string): Promise<void> {
    const index = articles.findIndex((article) => article.id === articleId);
    if (index < 0) return;

    await flushProgress();
    initialized = false;
    pendingJump = { articleId, offset: 0 };
    setActiveIndex(index);
    lastHandledTarget = articleId;
    await ensureArticle(articles[index]!);
    await tick();
    if (articleCache.get(articleId)?.html) schedulePendingJump();
  }

  export function jumpToHeading(headingId: string): void {
    const element = document.getElementById(headingId);
    element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  async function handleExit(): Promise<void> {
    progressDirty = true;
    await flushProgress();
    const articleId = articles[activeIndex]?.id;
    if (articleId) await onExit(articleId);
  }

  async function handleContentClick(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !surface) return;
    event.preventDefault();
    const images = Array.from(surface.querySelectorAll('img'));
    if (!imageViewer) {
      const { createViewer } = await import('luma-peek');
      imageViewer = createViewer();
    }
    imageViewer.open({
      items: images.map((image) => image.alt ? { src: image.src, alt: image.alt } : { src: image.src }),
      startIndex: Math.max(0, images.indexOf(target))
    });
  }

  function handleContentError(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    const slot = target.closest<HTMLElement>('[data-article-id]');
    const articleId = slot?.dataset.articleId;
    if (!articleId) return;
    const src = target.currentSrc || target.src;
    const reason = online
      ? 'Image failed to load or decode.'
      : 'Image cache miss or decode failure while offline.';
    onImageError({ articleId, src, reason });
  }

  function setupObservers(): void {
    if ('IntersectionObserver' in window) {
      intersectionObserver = new IntersectionObserver(scheduleEvaluation, {
        root: usesWindowScroll() ? null : surface,
        threshold: [0, 0.01, 0.5, 1]
      });
      slotElements.forEach((element) => intersectionObserver?.observe(element));
    }
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(handleResize);
      slotElements.forEach((element) => resizeObserver?.observe(element));
    }
  }

  async function initialize(): Promise<void> {
    const initialArticle = articles[activeIndex];
    if (!initialArticle) return;
    const readingState = await loadReadingState(initialArticle.id);
    if (disposed) return;

    pendingJump = { articleId: initialArticle.id, offset: readingState?.scrollPosition ?? 0 };
    await ensureArticle(initialArticle);
    await tick();
    if (disposed) return;
    setupObservers();
    if (articleCache.get(initialArticle.id)?.html) schedulePendingJump();
  }

  onMount(() => {
    const scrollTarget: EventTarget = usesWindowScroll() ? window : surface ?? window;
    scrollTarget.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', scheduleEvaluation, { passive: true });
    void initialize();

    return () => {
      if (progressDirty) persistIndex(activeIndex);
      disposed = true;
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      scrollTarget.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', scheduleEvaluation);
      if (evaluationFrame) window.cancelAnimationFrame(evaluationFrame);
      if (measurementFrame) window.cancelAnimationFrame(measurementFrame);
      if (progressTimer) window.clearTimeout(progressTimer);
      imageViewer?.destroy();
      imageViewer = null;
      articleCache.clear();
      measuredHeights.clear();
      slotElements.clear();
    };
  });
</script>

<section class="continuous-shell">
  <header class="continuous-header">
    <div>
      <span class="mode-label">Continuous reading</span>
      <h1>{group.title}</h1>
    </div>
    <button on:click={handleExit}>Exit continuous reading</button>
  </header>

  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <div
    class="continuous-surface"
    role="region"
    aria-label="Continuous articles"
    bind:this={surface}
    on:click={handleContentClick}
    on:error|capture={handleContentError}
    style={`--reader-font-size:${fontSize}px;`}
  >
    {#each articles as article, index (article.id)}
      <section
        class="article-slot"
        class:active={index === activeIndex}
        data-index={index}
        data-article-id={article.id}
        aria-labelledby={`continuous-title-${index}`}
        aria-busy={renderIndexes.includes(index) && Boolean(articleCache.get(article.id)?.loading)}
        style={renderIndexes.includes(index)
          ? (articleCache.get(article.id)?.html ? '' : `min-height:${measuredHeights.get(index) ?? estimatedHeight()}px;`)
          : `height:${measuredHeights.get(index) ?? estimatedHeight()}px;overflow:hidden;`}
        use:registerSlot={index}
      >
        <header class="article-boundary">
          <span>{article.order}</span>
          <h2 id={`continuous-title-${index}`}>{article.title}</h2>
        </header>

        {#if renderIndexes.includes(index)}
          {@const cached = articleCache.get(article.id)}
          {#if cached?.article?.content}
            <ContinuousArticle
              articleId={article.id}
              content={cached.article.content}
              cachedHtml={cached.html}
              {fontSize}
              onRendered={handleRendered}
            />
          {:else if cached?.error}
            <div class="article-error" role="alert">
              <strong>This article could not be opened.</strong>
              <p>{cached.error}</p>
            </div>
          {:else}
            <div class="article-loading">Loading article…</div>
          {/if}
        {/if}
      </section>
    {/each}
  </div>
</section>

<style>
  .continuous-shell {
    min-height: 0;
    height: 100%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .continuous-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.35rem;
  }

  .continuous-header h1 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: clamp(1.25rem, 2.5vw, 1.6rem);
  }

  .mode-label {
    display: block;
    margin-bottom: 0.1rem;
    color: var(--accent);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .continuous-header button {
    flex-shrink: 0;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    padding: 0.45rem 0.9rem;
    background: var(--bg-app);
    color: var(--text-main);
    font-size: 0.85rem;
    font-weight: 500;
  }

  .continuous-header button:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .continuous-surface {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    border-radius: 1rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-light);
    box-shadow: var(--shadow-sm);
    overflow-anchor: none;
    scroll-behavior: auto;
  }

  .article-slot {
    box-sizing: border-box;
    padding: 1.5rem 2.5rem 3rem;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-panel);
  }

  .article-slot:last-child {
    border-bottom: 0;
  }

  .article-slot.active .article-boundary span {
    color: var(--text-inverse);
    background: var(--accent);
  }

  .article-boundary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border-light);
  }

  .article-boundary span {
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    border-radius: 0.45rem;
    color: var(--accent);
    background: var(--accent-soft);
    font-size: 0.8rem;
    font-weight: 700;
  }

  .article-boundary h2 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 1.1rem;
  }

  .article-loading,
  .article-error {
    min-height: 12rem;
    display: grid;
    place-content: center;
    text-align: center;
    color: var(--text-muted);
  }

  .article-error p {
    margin: 0.4rem 0 0;
    color: var(--danger);
  }

  @media (max-width: 900px) {
    .continuous-shell {
      height: auto;
    }

    .continuous-header {
      align-items: flex-start;
      flex-direction: column;
      margin-bottom: 0.75rem;
    }

    .continuous-surface {
      overflow: visible;
    }

    .article-slot {
      padding: 1.25rem 1rem 2.5rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .continuous-surface {
      scroll-behavior: auto;
    }
  }
</style>
