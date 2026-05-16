<script lang="ts">
  import type { ReaderSettings, ThemeMode } from '../lib/types';

  export let settings: ReaderSettings;
  export let onThemeChange: (theme: ThemeMode) => void = () => {};
  export let onFontSizeChange: (size: number) => void = () => {};
  export let onClearData: () => void = () => {};
</script>

<section class="card">
  <h2>Reading settings</h2>
  <label>
    <span>Theme</span>
    <select value={settings.theme} on:change={(event) => onThemeChange((event.currentTarget as HTMLSelectElement).value as ThemeMode)}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>

  <label>
    <span>Font size</span>
    <input
      type="range"
      min="14"
      max="24"
      step="1"
      value={settings.fontSize}
      on:input={(event) => onFontSizeChange(Number((event.currentTarget as HTMLInputElement).value))}
    />
    <small>{settings.fontSize}px</small>
  </label>

  <button class="danger" on:click={onClearData}>Clear cached data</button>
</section>

<style>
  .card {
    display: grid;
    gap: 1.25rem;
    padding: 1.25rem;
    border-radius: 1rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-light);
    box-shadow: var(--shadow-sm);
  }

  .card h2 {
    font-size: 1.1rem;
    margin-bottom: 0;
  }

  label {
    display: grid;
    gap: 0.5rem;
    font-size: 0.9rem;
    font-weight: 500;
  }

  select,
  input[type='range'] {
    width: 100%;
  }

  select {
    padding: 0.6rem 0.85rem;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    background: var(--bg-app);
    color: var(--text-main);
    transition: border-color 0.2s;
  }

  select:focus {
    outline: none;
    border-color: var(--accent);
  }

  input[type='range'] {
    accent-color: var(--accent);
  }

  small {
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  .danger {
    border: 1px solid transparent;
    border-radius: 0.5rem;
    background: var(--danger-soft);
    color: var(--danger-text);
    padding: 0.6rem 1rem;
    font-weight: 500;
    font-size: 0.9rem;
  }

  .danger:hover {
    background: var(--danger);
    color: white;
  }
</style>
