<script lang="ts">
  import type { GroupListItem } from '../lib/types';

  export let groups: GroupListItem[] = [];
  export let selectedGroupId: string | null = null;
  export let onSelectGroup: (groupId: string) => void = () => {};
  export let onImportLocal: () => void = () => {};
  export let onRemoveGroup: (groupId: string) => void = () => {};
</script>

<section class="card">
  <div class="header">
    <h2>Bookshelf</h2>
    <button class="chip" on:click={onImportLocal}>Import</button>
  </div>

  {#if groups.length === 0}
    <p class="empty">Add a source or import local files.</p>
  {:else}
    <ul>
      {#each groups as group}
        <li class:selected={group.id === selectedGroupId}>
          <button class="group-button" on:click={() => onSelectGroup(group.id)}>
            <span class="title">{group.title}</span>
            <span class="badge">{group.articleCount}</span>
            <span
              class="remove"
              role="button"
              tabindex="0"
              aria-label={`Remove ${group.title}`}
              on:click|stopPropagation={() => onRemoveGroup(group.id)}
              on:keydown|stopPropagation={(e) => { if (e.key === 'Enter' || e.key === ' ') onRemoveGroup(group.id); }}
            >&times;</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .card {
    padding: 0.75rem;
    border-radius: 0.75rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-light);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0.5rem;
    margin-bottom: 0.25rem;
  }

  .header h2 {
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .chip {
    border: 1px solid var(--border-light);
    border-radius: 0.375rem;
    background: var(--bg-app);
    padding: 0.2rem 0.5rem;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .chip:hover {
    background: var(--bg-hover);
    color: var(--text-main);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 2px;
  }

  li {
    border-radius: 0.5rem;
    min-width: 0;
  }

  .group-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-width: 0;
    text-align: left;
    padding: 0.5rem 0.625rem;
    border-radius: 0.5rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-main);
    font-size: 0.875rem;
  }

  .group-button:hover {
    background: var(--bg-hover);
  }

  .selected .group-button {
    border-color: var(--border-focus);
    background: var(--bg-active);
    font-weight: 500;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    flex-shrink: 0;
    min-width: 1.5rem;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 0.7rem;
    font-weight: 600;
    text-align: center;
    line-height: 1.3;
  }

  .remove {
    flex-shrink: 0;
    width: 1.25rem;
    height: 1.25rem;
    border: 1px solid var(--border-light);
    border-radius: 50%;
    background: var(--bg-panel);
    color: var(--text-muted);
    font-size: 0.8rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
  }

  li:hover .remove {
    opacity: 1;
  }

  .remove:hover {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }

  .empty {
    color: var(--text-muted);
    font-size: 0.8rem;
    text-align: center;
    padding: 1rem 0.5rem;
  }
</style>
