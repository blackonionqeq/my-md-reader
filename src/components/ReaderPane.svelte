<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { renderMarkdownToHtml, renderMermaidBlocks, highlightCodeBlocks } from '../lib/markdown';
  import { collectHeadings } from '../lib/outline';
  import { resolveScrollTarget } from '../lib/reader-scroll';
  import type { OutlineHeading, ReaderArticle, ReadingState, TemporaryArticle } from '../lib/types';
  import type { Viewer } from 'luma-peek';

  export let article: ReaderArticle | null = null;
  export let readingState: ReadingState | null = null;
  export let restoreScrollPosition = false;
  export let fontSize = 18;
  export let online = true;
  export let onSaveProgress: (payload: {
    articleId: string;
    groupId: string;
    scrollPosition: number;
    progressRatio: number;
  }) => void = () => {};
  export let onOutlineChange: (headings: OutlineHeading[]) => void = () => {};
  export let onImportTemporary: (article: TemporaryArticle) => void = () => {};
  export let onImageError: (payload: { articleId: string; src: string; reason: string }) => void = () => {};
  export let onNavigatePrevious: (() => void) | null = null;
  export let onNavigateNext: (() => void) | null = null;
  export let previousTitle: string | null = null;
  export let nextTitle: string | null = null;

  let container: HTMLElement | null = null;
  let renderedHtml = '';
  let loadError = '';
  let scrollTimer: number | undefined;
  let renderRequestId = 0;
  let imageViewer: Viewer | null = null;
  let showScrollTop = false;

  function isTemporaryArticle(value: ReaderArticle | null): value is TemporaryArticle {
    return Boolean(value && 'isTemporary' in value);
  }

  async function refreshRenderedContent(): Promise<void> {
    const requestId = ++renderRequestId;
    loadError = '';

    if (!article || !('content' in article) || !article.content) {
      renderedHtml = '';
      onOutlineChange([]);
      return;
    }

    try {
      const html = await renderMarkdownToHtml(article.content);
      if (requestId !== renderRequestId) {
        return;
      }

      renderedHtml = html;
      await tick();

      if (requestId !== renderRequestId) {
        return;
      }

      if (container) {
        highlightCodeBlocks(container);
        await renderMermaidBlocks(container);
        onOutlineChange(collectHeadings(container));
        const target = resolveScrollTarget({
          restoreScrollPosition,
          savedPosition: readingState?.scrollPosition
        });
        // Desktop: scroll inside the container; window.scrollTo is a no-op
        // because the app shell is height:100vh with overflow:hidden.
        // Mobile: container has height:auto and doesn't scroll — the page
        // itself scrolls, so we use window.scrollTo for both restore and
        // reset-to-top.
        if (isContainerScrollable()) {
          container.scrollTop = target;
          window.scrollTo(0, 0);
        } else {
          window.scrollTo(0, target);
        }
      }
    } catch (error) {
      if (requestId !== renderRequestId) {
        return;
      }

      renderedHtml = `<pre>${article.content}</pre>`;
      loadError = error instanceof Error ? error.message : 'Markdown render failed.';
      onOutlineChange([]);
    }
  }

  // On desktop the .reader element is height-constrained by the grid and
  // scrolls internally.  On mobile (≤900px) it has height:auto so it grows
  // to fit content and the *window* scrolls instead.  We need to detect
  // which one is active to save and restore the right scroll offset.
  function isContainerScrollable(): boolean {
    return !!container && container.scrollHeight > container.clientHeight;
  }

  function persistProgress(): void {
    if (!article || !container || isTemporaryArticle(article)) {
      return;
    }

    const useContainer = isContainerScrollable();
    const scrollPos = useContainer ? container.scrollTop : window.scrollY;
    const maxScroll = useContainer
      ? Math.max(1, container.scrollHeight - container.clientHeight)
      : Math.max(1, document.documentElement.scrollHeight - window.innerHeight);

    onSaveProgress({
      articleId: article.id,
      groupId: article.groupId,
      scrollPosition: scrollPos,
      progressRatio: Math.min(1, scrollPos / maxScroll)
    });
  }

  function handleScroll(): void {
    if (scrollTimer) {
      window.clearTimeout(scrollTimer);
    }

    scrollTimer = window.setTimeout(() => persistProgress(), 200);
  }

  async function handleContentClick(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !container) {
      return;
    }

    event.preventDefault();

    const images = Array.from(container.querySelectorAll('img'));
    if (!imageViewer) {
      const { createViewer } = await import('luma-peek');
      imageViewer = createViewer();
    }

    imageViewer.open({
      items: images.map((img) => (img.alt ? { src: img.src, alt: img.alt } : { src: img.src })),
      startIndex: Math.max(0, images.indexOf(target))
    });
  }

  function handleContentError(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !article || isTemporaryArticle(article)) {
      return;
    }

    const src = target.currentSrc || target.src;
    const reason = online
      ? 'Image failed to load or decode.'
      : 'Image cache miss or decode failure while offline.';
    console.error('[image-cache] image element failed', {
      articleId: article.id,
      src,
      online,
      serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
      appVersion: __APP_VERSION__,
      buildTime: __BUILD_TIME__
    });
    onImageError({ articleId: article.id, src, reason });
  }

  $: void article, restoreScrollPosition, refreshRenderedContent();
  $: if (fontSize && container) {
    container.style.setProperty('--reader-font-size', `${fontSize}px`);
  }

  // On mobile the container doesn't scroll, so on:scroll on the <article>
  // never fires.  We listen on the window to catch page-level scrolling.
  function handleWindowScroll(): void {
    if (isContainerScrollable()) {
      showScrollTop = false;
      return;
    }
    showScrollTop = window.scrollY > window.innerHeight * 2;
    if (scrollTimer) {
      window.clearTimeout(scrollTimer);
    }
    scrollTimer = window.setTimeout(() => persistProgress(), 200);
  }

  function scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  onMount(() => {
    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleWindowScroll);
      if (scrollTimer) {
        window.clearTimeout(scrollTimer);
      }
      persistProgress();
      imageViewer?.destroy();
      imageViewer = null;
    };
  });
</script>

<section class="reader-shell">
  {#if article}
    <header class="reader-header">
      <h1>{article.title}</h1>
      {#if isTemporaryArticle(article)}
        <div class="actions">
          <button class="import" on:click={() => onImportTemporary(article)}>Add to shelf</button>
        </div>
      {/if}
    </header>

    {#if !('content' in article) || !article.content}
      <div class="empty">
        <strong>No local content yet</strong>
        <p>{online ? 'Download this article from the group directory.' : 'This article is not cached yet. Network access is required.'}</p>
      </div>
    {:else}
      {#if loadError}
        <p class="error">Markdown render fallback: {loadError}</p>
      {/if}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
      <article
        class="reader"
        bind:this={container}
        on:scroll={handleScroll}
        on:click={handleContentClick}
        on:error|capture={handleContentError}
        style={`--reader-font-size:${fontSize}px;`}
      >
        {@html renderedHtml}
        {#if onNavigatePrevious || onNavigateNext}
          <nav class="article-nav">
            {#if onNavigatePrevious}
              <button class="nav-btn nav-prev" on:click|stopPropagation={onNavigatePrevious}>
                <span class="nav-arrow">&larr;</span>
                <span class="nav-label">{previousTitle ?? 'Previous'}</span>
              </button>
            {:else}
              <div></div>
            {/if}
            {#if onNavigateNext}
              <button class="nav-btn nav-next" on:click|stopPropagation={onNavigateNext}>
                <span class="nav-label">{nextTitle ?? 'Next'}</span>
                <span class="nav-arrow">&rarr;</span>
              </button>
            {:else}
              <div></div>
            {/if}
          </nav>
        {/if}
      </article>
      {#if showScrollTop}
        <button
          class="scroll-top-fab"
          transition:fade={{ duration: 150 }}
          on:click={scrollToTop}
          aria-label="Back to top"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      {/if}
    {/if}
  {:else}
    <div class="empty reader-placeholder">
      <strong>Choose an article</strong>
      <p>Select a downloaded article or open a local markdown file to start reading.</p>
    </div>
  {/if}
</section>

<style>
  .reader-shell {
    min-height: 0;
    height: 100%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .reader-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    margin-bottom: 0.35rem;
  }

  .empty p,
  .error {
    color: var(--text-muted);
  }

  .reader-header h1 {
    font-size: clamp(1.25rem, 2.5vw, 1.6rem);
    margin: 0;
    font-family: var(--font-serif);
  }

  .actions {
    display: flex;
    gap: 0.75rem;
  }

  .actions button {
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    padding: 0.45rem 0.9rem;
    background: var(--bg-app);
    color: var(--text-main);
    font-size: 0.85rem;
    font-weight: 500;
  }

  .actions button:hover {
    background: var(--bg-hover);
  }

  .actions .import {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .actions .import:hover {
    background: var(--accent-hover);
  }

  .reader {
    min-height: 0;
    overflow: auto;
    padding: 1.5rem 2.5rem;
    border-radius: 1rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-light);
    box-shadow: var(--shadow-sm);
    font-family: var(--font-serif);
    font-size: var(--reader-font-size, 18px);
    line-height: 1.6;
    color: var(--text-main);
  }

  .reader :global(pre) {
    overflow: auto;
    padding: 1.25rem;
    border-radius: 0.5rem;
    background: var(--bg-app);
    border: 1px solid var(--border-light);
    font-family: var(--font-mono);
  }

  .reader :global(pre.mermaid) {
    text-align: center;
    background: transparent;
    border: none;
    padding: 1rem 0;
    font-family: inherit;
  }

  .reader :global(pre.mermaid svg) {
    max-width: 100%;
    height: auto;
  }

  .reader :global(code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
    background: var(--bg-app);
    padding: 0.2em 0.4em;
    border-radius: 0.25em;
  }

  .reader :global(pre code) {
    background: transparent;
    padding: 0;
  }

  .reader :global(img) {
    max-width: 100%;
    border-radius: 0.5rem;
    margin: 1.5rem 0;
    cursor: zoom-in;
  }

  .reader :global(blockquote) {
    border-left: 4px solid var(--accent);
    margin: 1.5rem 0;
    padding-left: 1rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .reader :global(h1),
  .reader :global(h2),
  .reader :global(h3),
  .reader :global(h4) {
    font-family: var(--font-ui);
    margin-top: 2rem;
    margin-bottom: 1rem;
    color: var(--text-main);
  }

  .reader :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .empty {
    padding: 3rem 1.5rem;
    border-radius: 1rem;
    background: var(--bg-panel);
    border: 1px dashed var(--border-focus);
    text-align: center;
  }

  .reader-placeholder {
    height: 100%;
    display: grid;
    place-items: center;
    text-align: center;
  }

  .article-nav {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border-light);
    font-family: var(--font-ui);
  }

  .nav-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    background: var(--bg-app);
    color: var(--text-main);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    max-width: 45%;
  }

  .nav-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
    color: var(--accent);
  }

  .nav-next {
    margin-left: auto;
    text-align: right;
  }

  .nav-arrow {
    flex-shrink: 0;
    font-size: 1rem;
  }

  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error {
    margin: 0 0 0.75rem;
    color: var(--danger);
  }

  @media (max-width: 1100px) {
    .article-nav {
      margin-bottom: 4rem;
    }
  }

  .scroll-top-fab {
    display: none;
  }

  @media (max-width: 900px) {
    .reader {
      height: auto;
      min-height: 55vh;
      padding: 1.25rem 1rem;
    }

    .reader-header {
      flex-direction: column;
    }

    .scroll-top-fab {
      display: flex;
      align-items: center;
      justify-content: center;
      position: fixed;
      bottom: 5rem;
      right: 1.25rem;
      width: 3rem;
      height: 3rem;
      border-radius: 50%;
      border: 1px solid var(--border-light);
      background: var(--bg-panel);
      color: var(--text-main);
      box-shadow: var(--shadow-md);
      z-index: 100;
    }
  }
</style>
