<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { renderMarkdownToHtml } from '../lib/markdown';
  import { collectHeadings } from '../lib/outline';
  import type { OutlineHeading, ReaderArticle, ReadingState, TemporaryArticle } from '../lib/types';

  export let article: ReaderArticle | null = null;
  export let readingState: ReadingState | null = null;
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
        onOutlineChange(collectHeadings(container));
        if (readingState?.scrollPosition) {
          container.scrollTop = readingState.scrollPosition;
        } else {
          container.scrollTop = 0;
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

  function persistProgress(): void {
    if (!article || !container || isTemporaryArticle(article)) {
      return;
    }

    const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
    onSaveProgress({
      articleId: article.id,
      groupId: article.groupId,
      scrollPosition: container.scrollTop,
      progressRatio: Math.min(1, container.scrollTop / maxScroll)
    });
  }

  function handleScroll(): void {
    if (scrollTimer) {
      window.clearTimeout(scrollTimer);
    }

    scrollTimer = window.setTimeout(() => persistProgress(), 200);
  }

  $: void article, refreshRenderedContent();
  $: if (fontSize && container) {
    container.style.setProperty('--reader-font-size', `${fontSize}px`);
  }

  onMount(() => () => {
    if (scrollTimer) {
      window.clearTimeout(scrollTimer);
    }
    persistProgress();
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
      <article
        class="reader"
        bind:this={container}
        on:scroll={handleScroll}
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

  .reader-header small,
  .empty p,
  .error {
    color: var(--text-muted);
  }

  .reader-header h1 {
    font-size: clamp(1.5rem, 3vw, 2.2rem);
    margin: 0.25rem 0 0;
    font-family: var(--font-serif);
  }

  .actions {
    display: flex;
    gap: 0.75rem;
  }

  .actions button {
    border: 1px solid var(--border-light);
    border-radius: 999px;
    padding: 0.5rem 1rem;
    background: var(--bg-panel);
    color: var(--text-main);
    font-size: 0.875rem;
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
    height: calc(100vh - 13rem);
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
    }

    .reader-header {
      flex-direction: column;
    }
  }
</style>
