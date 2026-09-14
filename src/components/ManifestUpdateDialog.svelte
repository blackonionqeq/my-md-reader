<script lang="ts">
  import type { DownloadProgress } from '../lib/content-service';
  import type { ManifestUpdateEntry, ManifestUpdateKind, ManifestUpdatePlan } from '../lib/types';

  export let open = false;
  export let plan: ManifestUpdatePlan | null = null;
  export let busy = false;
  export let error = '';
  export let onCancel: () => void = () => {};
  export let onApply: () => void = () => {};
  // The modal sits in the browser top layer, so the app-level notice and the
  // mobile download toast are both invisible while applying. Progress has to
  // render here.
  export let progress: DownloadProgress | null = null;

  let dialog: HTMLDialogElement | null = null;

  const sections: Array<{ kind: ManifestUpdateKind; label: string }> = [
    { kind: 'added', label: 'Added' },
    { kind: 'contentChanged', label: 'Content updates' },
    { kind: 'metadataChanged', label: 'Metadata updates' },
    { kind: 'removed', label: 'Removed' }
  ];

  $: if (dialog) {
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }

  function entries(kind: ManifestUpdateKind): ManifestUpdateEntry[] {
    return plan?.entries.filter((entry) => entry.kind === kind) ?? [];
  }

  // Blend image progress into the article fraction so long articles with many
  // images still advance the bar. `articleIndex` is the article in flight, so
  // the completed share is `articleIndex - 1` plus its own asset fraction.
  function completedFraction(current: DownloadProgress): number | null {
    if (current.articleTotal <= 0) return null;
    const assetFraction = current.assetTotal && current.assetTotal > 0
      ? Math.min(1, (current.assetIndex ?? 0) / current.assetTotal)
      : 0;
    return Math.min(1, (current.articleIndex - 1 + assetFraction) / current.articleTotal);
  }

  $: fraction = progress ? completedFraction(progress) : null;

  function handleBackdrop(event: MouseEvent): void {
    if (!busy && event.target === dialog) onCancel();
  }

  function handleCancel(event: Event): void {
    event.preventDefault();
    if (!busy) onCancel();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} on:click={handleBackdrop} on:cancel={handleCancel} on:close={() => { if (!busy) onCancel(); }}>
  {#if plan}
    <div class="dialog-inner">
      <header>
        <div>
          <h2>Manifest update</h2>
          <p>{plan.target.group.title}</p>
        </div>
        <button class="close" disabled={busy} on:click={onCancel} aria-label="Close">&times;</button>
      </header>

      <div class="body">
        <dl class="summary">
          <div><dt>Version</dt><dd>{plan.oldVersion || 'Unversioned'} → {plan.newVersion || 'Unversioned'}</dd></div>
          {#if plan.sourceUrlChanged}
            <div class="url-change">
              <dt>Source relocation</dt>
              <dd><code>{plan.oldManifestUrl}</code><span>→</span><code>{plan.newManifestUrl}</code></dd>
            </div>
          {/if}
        </dl>

        {#if busy}
          <section class="progress-block" aria-live="polite">
            {#if progress}
              <h3>
                Updating {progress.articleIndex} of {progress.articleTotal}
                changed {progress.articleTotal === 1 ? 'article' : 'articles'}
              </h3>
              {#if progress.assetTotal}
                <p>Image {progress.assetIndex ?? 0} of {progress.assetTotal}</p>
              {:else}
                <p>Downloading content…</p>
              {/if}
              <progress value={fraction ?? 0} max="1"></progress>
            {:else}
              <!-- Additions, removals, and metadata are written in one
                   transaction before the first download progress event. -->
              <h3>Applying changes…</h3>
              <p>Saving additions, removals, and metadata.</p>
              <progress></progress>
            {/if}
            <p class="hint">Keep this dialog open until the update finishes.</p>
          </section>
        {:else}
          {#if plan.legacyPrecision}
            <p class="warning">This manifest has articles without content hashes. Same-URL edits cannot be detected precisely unless the manifest version changes.</p>
          {/if}

          {#each sections as section}
            {@const items = entries(section.kind)}
            {#if items.length > 0}
              <section class:destructive={section.kind === 'removed'}>
                <h3>{section.label} <span>{items.length}</span></h3>
                <ul>
                  {#each items as item}
                    <li>
                      <strong>{item.title}</strong>
                      {#if item.previousTitle && item.previousTitle !== item.title}
                        <small>Previously: {item.previousTitle}</small>
                      {/if}
                    </li>
                  {/each}
                </ul>
                {#if section.kind === 'removed'}
                  <p>Removed articles permanently lose downloaded content, images, favorites, and reading progress.</p>
                {/if}
              </section>
            {/if}
          {/each}

          {#if plan.groupMetadataChanged && plan.entries.every((entry) => entry.kind === 'unchanged')}
            <p class="metadata-note">Only collection metadata changes.</p>
          {/if}
        {/if}
        {#if error}<p class="error">{error}</p>{/if}
      </div>

      <footer>
        <button class="secondary" disabled={busy} on:click={onCancel}>Cancel</button>
        <button class="primary" disabled={busy} on:click={onApply}>{busy ? 'Applying…' : 'Apply update'}</button>
      </footer>
    </div>
  {/if}
</dialog>

<style>
  dialog { width: min(42rem, 92vw); max-height: 86vh; padding: 0; border: 1px solid var(--border-light); border-radius: 1rem; background: var(--bg-panel); color: var(--text-main); box-shadow: var(--shadow-md); }
  dialog::backdrop { background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(4px); }
  .dialog-inner { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; max-height: 86vh; }
  header, footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; }
  header { border-bottom: 1px solid var(--border-light); }
  header h2, header p { margin: 0; }
  header p { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.2rem; }
  .close { border: 0; background: transparent; color: var(--text-muted); font-size: 1.5rem; }
  .body { overflow-y: auto; padding: 1.25rem; display: grid; gap: 1rem; }
  .summary { display: grid; gap: 0.65rem; margin: 0; }
  .summary > div { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: 0.75rem; }
  dt { color: var(--text-muted); }
  dd { margin: 0; min-width: 0; }
  .url-change dd { display: grid; gap: 0.35rem; }
  code { overflow-wrap: anywhere; font-size: 0.78rem; }
  section { border: 1px solid var(--border-light); border-radius: 0.75rem; padding: 0.85rem; }
  section h3 { margin: 0 0 0.6rem; font-size: 0.95rem; }
  section h3 span { color: var(--text-muted); font-weight: 400; }
  ul { margin: 0; padding-left: 1.25rem; display: grid; gap: 0.35rem; }
  li small { display: block; color: var(--text-muted); }
  .progress-block { display: grid; gap: 0.5rem; }
  .progress-block p { margin: 0; color: var(--text-muted); font-size: 0.85rem; }
  .progress-block .hint { color: var(--text-muted); font-size: 0.78rem; }
  progress { width: 100%; height: 0.5rem; appearance: none; border: 0; border-radius: 999px; background: var(--bg-app); overflow: hidden; }
  progress::-webkit-progress-bar { background: var(--bg-app); border-radius: 999px; }
  progress::-webkit-progress-value { background: var(--accent); border-radius: 999px; transition: width 0.2s; }
  progress::-moz-progress-bar { background: var(--accent); border-radius: 999px; }
  .warning, .destructive { border-color: color-mix(in srgb, var(--danger) 45%, var(--border-light)); }
  .warning, .destructive p, .error { color: var(--danger); }
  .warning, .metadata-note, .destructive p, .error { margin: 0; font-size: 0.85rem; }
  footer { border-top: 1px solid var(--border-light); justify-content: flex-end; }
  footer button { border-radius: 0.5rem; padding: 0.5rem 0.9rem; font-weight: 600; }
  .primary { border: 1px solid transparent; background: var(--accent); color: white; }
  .secondary { border: 1px solid var(--border-light); background: var(--bg-app); color: var(--text-main); }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  @media (max-width: 600px) { .summary > div { grid-template-columns: 1fr; gap: 0.2rem; } }
</style>
