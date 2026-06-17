<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { renderMarkdownToHtml, renderMermaidBlocks } from '../lib/markdown';
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
  export let onToggleFavorite: (value: boolean) => void = () => {};
  export let onOutlineChange: (headings: OutlineHeading[]) => void = () => {};
  export let onImportTemporary: (article: TemporaryArticle) => void = () => {};

  let container: HTMLElement | null = null;
  let renderedHtml = '';
  let loadError = '';
  let scrollTimer: number | undefined;
  let renderRequestId = 0;
  let imageViewer: Viewer | null = null;

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

  $: void article, restoreScrollPosition, refreshRenderedContent();
  $: if (fontSize && container) {
    container.style.setProperty('--reader-font-size', `${fontSize}px`);
  }

  // On mobile the container doesn't scroll, so on:scroll on the <article>
  // never fires.  We listen on the window to catch page-level scrolling.
  function handleWindowScroll(): void {
    if (isContainerScrollable()) {
      return;
    }
    if (scrollTimer) {
      window.clearTimeout(scrollTimer);
    }
    scrollTimer = window.setTimeout(() => persistProgress(), 200);
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
      <div>
        <small>{isTemporaryArticle(article) ? 'Temporary local file' : 'Reader'}</small>
        <h1>{article.title}</h1>
      </div>
      <div class="actions">
        {#if !isTemporaryArticle(article)}
          <button class:favorited={readingState?.isFavorite} on:click={() => onToggleFavorite(!(readingState?.isFavorite ?? false))}>
            {readingState?.isFavorite ? 'Favorited' : 'Favorite'}
          </button>
        {/if}
        {#if isTemporaryArticle(article)}
          <button class="import" on:click={() => onImportTemporary(article)}>Add to shelf</button>
        {/if}
      </div>
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
        style={`--reader-font-size:${fontSize}px;`}
      >
        {@html renderedHtml}
      </article>
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
    align-items: start;
    margin-bottom: 1rem;
  }

  .empty p,
  .error {
    color: var(--text-muted);
  }

  .reader-header small {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .reader-header h1 {
    font-size: clamp(1.5rem, 3vw, 2.2rem);
    margin: 0.5rem 0 0;
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

  .actions button.favorited {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
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
    padding: 2.5rem 3rem;
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

  .error {
    margin: 0 0 0.75rem;
    color: var(--danger);
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
  }
</style>
