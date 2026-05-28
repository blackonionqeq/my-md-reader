<script lang="ts">
  import type { ManifestPreview, UrlArticlePreview } from '../lib/types';

  export let manifestUrl = '';
  export let preview: ManifestPreview | null = null;
  export let urlPreview: UrlArticlePreview | null = null;
  export let busy = false;
  export let error = '';
  export let onUrlChange: (value: string) => void = () => {};
  export let onPreview: () => void = () => {};
  export let onSave: () => void = () => {};
</script>

<section class="card">
  <div class="section-head">
    <h2>Add from URL</h2>
    <p>Paste a markdown file URL or a `manifest.json` URL.</p>
  </div>

  <label>
    <span>URL</span>
    <input
      type="url"
      placeholder="https://example.com/article.md"
      value={manifestUrl}
      on:input={(event) => onUrlChange((event.currentTarget as HTMLInputElement).value)}
    />
  </label>

  <div class="actions">
    <button class="secondary" on:click={onPreview} disabled={busy || !manifestUrl.trim()}>
      {busy ? 'Checking...' : 'Preview'}
    </button>
    <button class="primary" on:click={onSave} disabled={busy || (!preview && !urlPreview)}>
      Add to shelf
    </button>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if preview}
    <div class="preview">
      <strong>{preview.group.title}</strong>
      <span>{preview.group.articleCount} articles</span>
      {#if preview.group.description}
        <p>{preview.group.description}</p>
      {/if}
      <small>{preview.manifestUrl}</small>
    </div>
  {/if}

  {#if urlPreview}
    <div class="preview">
      <strong>{urlPreview.title}</strong>
      <span>Single article</span>
      <small>{urlPreview.url}</small>
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

  .section-head h2 {
    font-size: 1.1rem;
    margin-bottom: 0.25rem;
  }

  .section-head p {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin-bottom: 0;
  }

  .preview p {
    color: var(--text-muted);
  }

  label {
    display: grid;
    gap: 0.4rem;
    margin-top: 1rem;
    font-size: 0.9rem;
    font-weight: 500;
  }

  input {
    width: 100%;
    padding: 0.6rem 0.85rem;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    background: var(--bg-app);
    color: var(--text-main);
    transition: border-color 0.2s;
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  button {
    border: 1px solid transparent;
    border-radius: 0.5rem;
    padding: 0.5rem 1rem;
    font-weight: 500;
    font-size: 0.9rem;
  }

  .primary {
    background: var(--accent);
    color: white;
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .secondary {
    background: var(--bg-app);
    color: var(--text-main);
    border-color: var(--border-light);
  }

  .secondary:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .error {
    margin-top: 0.75rem;
    color: var(--danger);
    font-size: 0.9rem;
  }

  .preview {
    margin-top: 1rem;
    padding: 0.9rem;
    border-radius: 0.75rem;
    background: var(--accent-soft);
  }

  .preview strong {
    display: block;
    margin-bottom: 0.25rem;
  }

  small {
    color: var(--text-muted);
    font-size: 0.8rem;
    display: block;
    margin-top: 0.5rem;
  }
</style>
