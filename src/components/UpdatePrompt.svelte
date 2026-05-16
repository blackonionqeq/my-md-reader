<script lang="ts">
  export let offlineReady = false;
  export let needRefresh = false;
  export let onReload: () => void = () => {};
  export let onDismiss: () => void = () => {};
</script>

{#if offlineReady || needRefresh}
  <div class="toast" role="alert">
    <strong>{needRefresh ? 'Update available' : 'Offline ready'}</strong>
    <p>
      {#if needRefresh}
        A newer app shell is ready. Reload to activate it.
      {:else}
        The app shell is cached for offline reading.
      {/if}
    </p>
    <div class="actions">
      {#if needRefresh}
        <button class="primary" on:click={onReload}>Reload</button>
      {/if}
      <button on:click={onDismiss}>Close</button>
    </div>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    width: min(22rem, calc(100vw - 2rem));
    padding: 1rem;
    border: 1px solid rgba(20, 59, 54, 0.22);
    border-radius: 1rem;
    background: rgba(244, 239, 227, 0.98);
    box-shadow: 0 20px 40px rgba(20, 59, 54, 0.16);
    z-index: 30;
  }

  strong {
    display: block;
    margin-bottom: 0.35rem;
  }

  p {
    margin: 0;
    color: var(--muted);
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  button {
    border: 0;
    border-radius: 999px;
    background: rgba(20, 59, 54, 0.12);
    color: var(--ink);
    padding: 0.6rem 1rem;
  }

  .primary {
    background: var(--accent);
    color: white;
  }
</style>
