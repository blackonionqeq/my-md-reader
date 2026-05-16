<script lang="ts">
  import { formatRelativeTime } from '../lib/format';
  import type { GroupListItem } from '../lib/types';

  export let groups: GroupListItem[] = [];
  export let selectedGroupId: string | null = null;
  export let onSelectGroup: (groupId: string) => void = () => {};
  export let onImportLocal: () => void = () => {};
  export let onRemoveGroup: (groupId: string) => void = () => {};
</script>

<section class="card">
  <div class="header">
    <div>
      <h2>Bookshelf</h2>
      <p>Your imported and remote markdown collections.</p>
    </div>
    <button class="chip" on:click={onImportLocal}>Import `.md`</button>
  </div>

  {#if groups.length === 0}
    <div class="empty">
      <strong>No groups yet</strong>
      <p>Add a manifest below or import local markdown files.</p>
    </div>
  {:else}
    <ul>
      {#each groups as group}
        <li class:selected={group.id === selectedGroupId}>
          <button class="group-button" on:click={() => onSelectGroup(group.id)}>
            <strong>{group.title}</strong>
            <span>{group.articleCount} articles</span>
            <span class="status">{group.offlineStatus.replace('_', ' ')}</span>
            <small>
              {group.lastReadTitle ? `${group.lastReadTitle} · ` : ''}{formatRelativeTime(group.lastReadAt)}
            </small>
          </button>
          <button
            class="remove"
            aria-label={`Remove ${group.title}`}
            on:click={() => onRemoveGroup(group.id)}
          >
            Remove
          </button>
        </li>
      {/each}
    </ul>
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
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    align-items: start;
    margin-bottom: 0.5rem;
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

  .chip {
    border: 1px solid var(--border-light);
    border-radius: 999px;
    background: var(--bg-app);
    padding: 0.4rem 0.75rem;
    color: var(--text-main);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .chip:hover {
    background: var(--bg-hover);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 1rem 0 0;
    display: grid;
    gap: 0.5rem;
  }

  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
    align-items: center;
  }

  .group-button {
    display: grid;
    gap: 0.2rem;
    width: 100%;
    text-align: left;
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-main);
  }

  .group-button:hover {
    background: var(--bg-hover);
  }

  .selected .group-button {
    border-color: var(--border-focus);
    background: var(--bg-active);
  }

  .status,
  small {
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  .remove {
    border: 0;
    border-radius: 0.5rem;
    background: var(--danger-soft);
    color: var(--danger-text);
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    opacity: 0;
  }

  li:hover .remove {
    opacity: 1;
  }

  .remove:hover {
    background: var(--danger);
    color: white;
  }

  .empty {
    margin-top: 1rem;
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
