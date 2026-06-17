<script lang="ts">
  import { articleStatusLabel } from '../lib/format';
  import type { Article, Group } from '../lib/types';

  export let group: Group | null = null;
  export let articles: Article[] = [];
  export let selectedArticleId: string | null = null;
  export let onSelectArticle: (articleId: string) => void = () => {};
  export let onDownloadAll: () => void = () => {};
  export let onRetryFailed: () => void = () => {};
</script>

<section class="card">
  {#if group}
    <div class="header">
      <div>
        <h2>{group.title}</h2>
        <p>{group.description || 'Group directory'}</p>
      </div>
      <div class="actions">
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

    <ul>
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
    padding: 1.5rem;
    border-radius: var(--radius-lg);
    background: var(--bg-panel);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--border-light);
    box-shadow: var(--shadow-md);
    transition: box-shadow 0.3s ease;
  }

  .card:hover {
    box-shadow: var(--shadow-lg);
  }

  .header {
    display: grid;
    gap: 1.25rem;
  }

  .header h2 {
    font-size: 1.4rem;
    margin-bottom: 0.25rem;
    font-weight: 800;
    color: var(--text-main);
    letter-spacing: -0.02em;
  }

  .header p {
    color: var(--text-muted);
    font-size: 0.95rem;
    margin-bottom: 0;
    line-height: 1.4;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .actions button {
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    padding: 0.6rem 1.2rem;
    font-size: 0.85rem;
    font-weight: 700;
    box-shadow: var(--shadow-sm);
    transition: all 0.2s ease;
  }

  .primary {
    background: var(--accent);
    color: var(--text-inverse);
  }

  .primary:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .secondary {
    background: var(--bg-app);
    color: var(--text-main);
    border-color: var(--border-light) !important;
  }

  .secondary:hover {
    background: var(--bg-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border-light);
    color: var(--text-muted);
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 1.5rem 0 0;
    display: grid;
    gap: 0.6rem;
  }

  .article-button {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 1rem;
    align-items: center;
    text-align: left;
    padding: 0.85rem 1rem;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-main);
    transition: all 0.2s ease;
  }

  .article-button:hover {
    background: var(--bg-hover);
    transform: translateX(2px);
  }

  .selected .article-button {
    border-color: var(--border-focus);
    background: var(--accent-soft);
    box-shadow: var(--shadow-sm);
  }

  .selected .article-button strong {
    color: var(--accent);
  }

  .order {
    width: 2rem;
    height: 2rem;
    display: inline-grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--bg-active);
    color: var(--text-muted);
    font-weight: 700;
    font-size: 0.85rem;
    transition: all 0.2s ease;
  }

  .selected .order {
    background: var(--accent);
    color: var(--text-inverse);
  }

  .article-button div {
    display: grid;
    gap: 0.2rem;
  }

  .article-button strong {
    font-size: 1rem;
    font-weight: 600;
  }

  small {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-weight: 500;
  }

  .error {
    display: block;
    color: var(--danger);
  }

  .empty {
    padding: 3rem 1.5rem;
    border-radius: var(--radius-lg);
    background: var(--bg-app);
    text-align: center;
    border: 2px dashed var(--border-light);
    color: var(--text-muted);
  }

  .empty strong {
    display: block;
    font-size: 1.1rem;
    color: var(--text-main);
    margin-bottom: 0.5rem;
  }
</style>
