<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { highlightCodeBlocks, renderMarkdownToHtml, renderMermaidBlocks } from '../lib/markdown';
  import { collectHeadings } from '../lib/outline';
  import type { OutlineHeading } from '../lib/types';

  export let articleId: string;
  export let content: string;
  export let cachedHtml: string | undefined = undefined;
  export let fontSize = 18;
  export let onRendered: (result: {
    articleId: string;
    html: string;
    headings: OutlineHeading[];
  }) => void = () => {};

  let container: HTMLElement | null = null;
  let renderedHtml = '';
  let renderError = '';
  let renderGeneration = 0;

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function renderContent(): Promise<void> {
    const generation = ++renderGeneration;
    renderError = '';

    try {
      renderedHtml = cachedHtml ?? await renderMarkdownToHtml(content);
      await tick();

      if (generation !== renderGeneration || !container) {
        return;
      }

      const headings = collectHeadings(container, articleId);
      const reusableHtml = container.innerHTML;
      onRendered({ articleId, html: reusableHtml, headings });

      await highlightCodeBlocks(container);
      if (generation !== renderGeneration || !container) {
        return;
      }

      try {
        await renderMermaidBlocks(container);
      } catch (error) {
        console.error('[continuous-reader] Mermaid rendering failed', { articleId, error });
      }
    } catch (error) {
      if (generation !== renderGeneration) {
        return;
      }

      renderError = error instanceof Error ? error.message : 'Markdown render failed.';
      renderedHtml = `<pre>${escapeHtml(content)}</pre>`;
      await tick();
      if (generation === renderGeneration && container) {
        onRendered({ articleId, html: renderedHtml, headings: [] });
      }
    }
  }

  $: void articleId, content, cachedHtml, renderContent();

  onDestroy(() => {
    renderGeneration += 1;
  });
</script>

{#if renderError}
  <p class="render-error">Markdown render fallback: {renderError}</p>
{/if}

<div
  class="continuous-article-body"
  bind:this={container}
  style={`--reader-font-size:${fontSize}px;`}
>
  {@html renderedHtml}
</div>

<style>
  .render-error {
    margin: 0 0 0.75rem;
    color: var(--danger);
    font-family: var(--font-ui);
    font-size: 0.875rem;
  }

  .continuous-article-body {
    font-family: var(--font-serif);
    font-size: var(--reader-font-size, 18px);
    line-height: 1.6;
    color: var(--text-main);
  }

  .continuous-article-body :global(pre) {
    overflow: auto;
    padding: 1.25rem;
    border-radius: 0.5rem;
    background: var(--bg-app);
    border: 1px solid var(--border-light);
    font-family: var(--font-mono);
  }

  .continuous-article-body :global(pre.mermaid) {
    text-align: center;
    background: transparent;
    border: none;
    padding: 1rem 0;
    font-family: inherit;
  }

  .continuous-article-body :global(pre.mermaid svg) {
    max-width: 100%;
    height: auto;
  }

  .continuous-article-body :global(code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
    background: var(--bg-app);
    padding: 0.2em 0.4em;
    border-radius: 0.25em;
  }

  .continuous-article-body :global(pre code) {
    background: transparent;
    padding: 0;
  }

  .continuous-article-body :global(img) {
    max-width: 100%;
    border-radius: 0.5rem;
    margin: 1.5rem 0;
    cursor: zoom-in;
  }

  .continuous-article-body :global(blockquote) {
    border-left: 4px solid var(--accent);
    margin: 1.5rem 0;
    padding-left: 1rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .continuous-article-body :global(h1),
  .continuous-article-body :global(h2),
  .continuous-article-body :global(h3),
  .continuous-article-body :global(h4) {
    font-family: var(--font-ui);
    margin-top: 2rem;
    margin-bottom: 1rem;
    color: var(--text-main);
  }

  .continuous-article-body :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
