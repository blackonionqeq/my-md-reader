<script lang="ts">
  import { tick } from 'svelte';
  import { articleStatusLabel } from '../lib/format';
  import type { Article, Group } from '../lib/types';

  export let group: Group | null = null;
  export let articles: Article[] = [];
  export let selectedArticleId: string | null = null;
  export let onSelectArticle: (articleId: string) => void = () => {};
  export let onDownloadAll: () => void = () => {};
  export let onRetryFailed: () => void = () => {};
  export let continuousReading = false;
  export let continuousReadingAvailable = false;
  export let continuousReadingDisabledReason = '';
  export let onEnterContinuousReading: () => void = () => {};

  $: if (selectedArticleId) {
    tick().then(() => {
      const el = document.querySelector('.group-detail-list .selected');
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
</script>

<section class="card">
  {#if group}
    <div class="header">
      <div>
        <h2>{group.title}</h2>
        <p>{group.description || 'Group directory'}</p>
      </div>
      <div class="actions">
        <button
          class="continuous"
          class:active={continuousReading}
          disabled={!continuousReadingAvailable || continuousReading}
          title={!continuousReadingAvailable ? continuousReadingDisabledReason : undefined}
          on:click={onEnterContinuousReading}
        >
          {continuousReading ? 'Continuous reading active' : 'Continuous reading'}
        </button>
        <button class="primary" on:click={onDownloadAll}>Download all</button>
        <button class="secondary" on:click={onRetryFailed}>Retry failed</button>
      </div>
    </div>

    <div class="meta">
      <span>{group.articleCount} articles</span>
      <span>{group.offlineStatus.replace('_', ' ')}</span>
      {#if group.version}
        <span>v{group.version}</span>
      {/if}
    </div>

    <ul class="group-detail-list">
      {#each articles as article}
        <li class:selected={article.id === selectedArticleId}>
          <button class="article-button" on:click={() => onSelectArticle(article.id)}>
            <span class="order">{article.order}</span>
            <div>
              <strong>{article.title}</strong>
              <small>{articleStatusLabel(article.downloadStatus)}</small>
              {#if article.errorMessage}
                <small class="error">{article.errorMessage}</small>
              {/if}
            </div>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="empty">
      <strong>Select a group</strong>
      <p>The article directory will appear here.</p>
    </div>
  {/if}
</section>

<style>
  .card {
    padding: 1.25rem;
    border-radius: 1rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-light);
    box-shadow: var(--shadow-sm);
  }

  .header {
    display: grid;
    gap: 0.75rem;
  }

  .header h2 {
    font-size: 1.1rem;
    margin-bottom: 0.25rem;
  }

  .header p {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin-bottom: 0;
  }

  .meta {
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  small {
    color: var(--text-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .actions button {
    border: 1px solid transparent;
    border-radius: 0.5rem;
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .primary {
    background: var(--accent);
    color: white;
  }

  .primary:hover {
    background: var(--accent-hover);
  }

  .secondary {
    background: var(--bg-app);
    color: var(--text-main);
    border-color: var(--border-light) !important;
  }

  .continuous {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--border-focus) !important;
  }

  .continuous:hover:not(:disabled) {
    background: var(--bg-active);
  }

  .continuous:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .continuous.active {
    opacity: 0.8;
  }

  .secondary:hover {
    background: var(--bg-hover);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem;
    margin-top: 1rem;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 1rem 0 0;
    display: grid;
    gap: 0.5rem;
  }

  .article-button {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    align-items: start;
    text-align: left;
    padding: 0.75rem;
    border-radius: 0.75rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-main);
  }

  .article-button:hover {
    background: var(--bg-hover);
  }

  .selected .article-button {
    border-color: var(--border-focus);
    background: var(--bg-active);
  }

  .order {
    width: 1.75rem;
    height: 1.75rem;
    display: inline-grid;
    place-items: center;
    border-radius: 0.35rem;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
    font-size: 0.8rem;
  }

  .article-button div {
    display: grid;
    gap: 0.15rem;
  }

  .error {
    display: block;
    color: var(--danger);
  }

  .empty {
    padding: 1.25rem;
    border-radius: 0.75rem;
    background: var(--bg-app);
    text-align: center;
    border: 1px dashed var(--border-focus);
  }

  .empty p {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin-top: 0.5rem;
  }
</style>
