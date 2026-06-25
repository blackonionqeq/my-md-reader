<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { renderMarkdownToHtml, highlightCodeBlocks } from '../lib/markdown';
  import manifestDoc from '../../docs/manifest-format.md?raw';

  export let open = false;
  export let onClose: () => void = () => {};

  let dialog: HTMLDialogElement | null = null;
  let contentEl: HTMLElement | null = null;
  let renderedHtml = '';

  onMount(async () => {
    renderedHtml = await renderMarkdownToHtml(manifestDoc);
    await tick();
    if (contentEl) highlightCodeBlocks(contentEl);
  });

  $: if (dialog) {
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialog) {
      onClose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} on:close={onClose} on:click={handleBackdropClick}>
  <div class="dialog-inner">
    <header>
      <h2>Manifest Format</h2>
      <button class="close-btn" on:click={onClose} aria-label="Close">&times;</button>
    </header>
    <article class="reader" bind:this={contentEl}>
      {@html renderedHtml}
    </article>
  </div>
</dialog>

<style>
  dialog {
    max-width: min(56rem, 90vw);
    max-height: 85vh;
    width: 100%;
    padding: 0;
    border: 1px solid var(--border-light);
    border-radius: 1rem;
    background: var(--bg-panel);
    color: var(--text-main);
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
  }

  .dialog-inner {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    max-height: 85vh;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border-light);
    position: sticky;
    top: 0;
    background: var(--bg-panel);
    border-radius: 1rem 1rem 0 0;
    z-index: 1;
  }

  header h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    line-height: 1;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 0.25rem;
  }

  .close-btn:hover {
    color: var(--text-main);
    background: var(--bg-hover);
  }

  .reader {
    padding: 1.5rem 2rem 2rem;
    overflow-y: auto;
    font-size: 0.95rem;
    line-height: 1.6;
  }

  .reader :global(h1) {
    display: none;
  }

  .reader :global(h2) {
    font-size: 1.15rem;
    margin-top: 2rem;
    margin-bottom: 0.75rem;
    color: var(--text-main);
  }

  .reader :global(h3) {
    font-size: 1rem;
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    color: var(--text-main);
  }

  .reader :global(pre) {
    overflow: auto;
    padding: 1rem;
    border-radius: 0.5rem;
    background: var(--bg-app);
    border: 1px solid var(--border-light);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }

  .reader :global(code) {
    font-family: var(--font-mono);
    font-size: 0.88em;
    background: var(--bg-app);
    padding: 0.15em 0.35em;
    border-radius: 0.25em;
  }

  .reader :global(pre code) {
    background: transparent;
    padding: 0;
  }

  .reader :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.9rem;
  }

  .reader :global(th),
  .reader :global(td) {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-light);
    text-align: left;
  }

  .reader :global(th) {
    background: var(--bg-app);
    font-weight: 600;
  }

  .reader :global(p) {
    margin: 0.75rem 0;
  }

  .reader :global(ul),
  .reader :global(ol) {
    padding-left: 1.5rem;
    margin: 0.75rem 0;
  }

  .reader :global(li) {
    margin: 0.35rem 0;
  }

  .reader :global(a) {
    color: var(--accent);
  }

  @media (max-width: 600px) {
    dialog {
      max-width: 100vw;
      max-height: 100vh;
      height: 100%;
      border-radius: 0;
    }

    .dialog-inner {
      max-height: 100vh;
    }

    header {
      border-radius: 0;
    }

    .reader {
      padding: 1rem;
    }
  }
</style>
