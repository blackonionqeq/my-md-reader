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
          </button>
          <button
            class="remove"
            aria-label={`Remove ${group.title}`}
            on:click={() => onRemoveGroup(group.id)}
          >&times;</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .card {
    padding: 1.25rem;
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
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 0.25rem;
    margin-bottom: 0.75rem;
  }

  .header h2 {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    opacity: 0.9;
  }

  .chip {
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    padding: 0.35rem 0.75rem;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    box-shadow: var(--shadow-sm);
    transition: all 0.2s ease;
  }

  .chip:hover {
    background: var(--bg-hover);
    color: var(--text-main);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.4rem;
  }

  li {
    position: relative;
    border-radius: var(--radius-md);
  }

  .group-button {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    text-align: left;
    padding: 0.65rem 0.85rem;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-main);
    font-size: 0.9rem;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .group-button:hover {
    background: var(--bg-hover);
  }

  .selected .group-button {
    border-color: var(--border-focus);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 700;
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
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 0.7rem;
    font-weight: 700;
    text-align: center;
    line-height: 1.3;
    box-shadow: var(--shadow-sm);
  }

  .selected .badge {
    background: var(--accent);
    color: var(--text-inverse);
  }

  .remove {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    font-size: 1.1rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.2s ease;
  }

  li:hover .remove {
    opacity: 0.6;
  }

  .remove:hover {
    opacity: 1 !important;
    background: var(--danger-soft);
    color: var(--danger);
  }

  .empty {
    color: var(--text-muted);
    font-size: 0.85rem;
    text-align: center;
    padding: 1.5rem 0.5rem;
    border: 1px dashed var(--border-light);
    border-radius: var(--radius-md);
    margin: 0.5rem 0;
  }
</style>
