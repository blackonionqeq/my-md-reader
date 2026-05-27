<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import AddSourceForm from './components/AddSourceForm.svelte';
  import Bookshelf from './components/Bookshelf.svelte';
  import GroupDetail from './components/GroupDetail.svelte';
  import ReaderPane from './components/ReaderPane.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import {
    clearAllData,
    downloadGroup,
    hydrateArticleAssets,
    importLocalFiles,
    loadArticles,
    loadGroups,
    loadReadingState,
    openSingleLocalFile,
    previewManifest,
    removeGroup,
    retryFailedArticles,
    saveManifestSource,
    saveReadingProgress,
    saveTemporaryArticle,
    toggleFavorite
  } from './lib/content-service';
  import { dropImport } from './lib/drop-import';
  import type { FocusModeController } from './lib/focus-mode';
  import { applyTheme, loadSettings, normalizeFontSize, saveSettings } from './lib/settings';
  import type {
    Article,
    Group,
    GroupListItem,
    ManifestPreview,
    OutlineHeading,
    ReaderArticle,
    ReaderSettings,
    ReadingState,
    TemporaryArticle,
    ThemeMode
  } from './lib/types';

  let manifestUrl = '';
  let preview: ManifestPreview | null = null;
  let manifestBusy = false;
  let manifestError = '';

  let groups: GroupListItem[] = [];
  let selectedGroup: Group | null = null;
  let selectedGroupId: string | null = null;
  let articles: Article[] = [];
  let selectedArticle: ReaderArticle | null = null;
  let selectedArticleId: string | null = null;
  let readingState: ReadingState | null = null;
  let settings: ReaderSettings = loadSettings();
  let fileInput: HTMLInputElement | null = null;
  let online = typeof navigator === 'undefined' ? true : navigator.onLine;
  let outline: OutlineHeading[] = [];
  let message = '';
  let messageTone: 'info' | 'error' = 'info';
  let showSettings = false;
  let showDirectory = false;
  let dragging = false;
  let focusMode = false;
  let focusController: FocusModeController | null = null;

  function setMessage(value: string, tone: 'info' | 'error' = 'info'): void {
    message = value;
    messageTone = tone;
  }

  async function refreshGroups(): Promise<void> {
    groups = await loadGroups();
    if (selectedGroupId) {
      const updated = groups.find((group) => group.id === selectedGroupId);
      selectedGroup = updated ?? null;
    }
  }

  async function selectGroup(groupId: string): Promise<void> {
    selectedGroupId = groupId;
    selectedGroup = groups.find((group) => group.id === groupId) ?? null;
    articles = await loadArticles(groupId);
    showDirectory = true;

    if (selectedArticleId && articles.some((article) => article.id === selectedArticleId)) {
      return;
    }

    const defaultArticle =
      articles.find((article) => article.id === selectedGroup?.lastReadArticleId)
      ?? articles.find((article) => article.downloadStatus === 'downloaded')
      ?? articles[0];

    if (defaultArticle) {
      await openArticle(defaultArticle.id);
    } else {
      selectedArticle = null;
      selectedArticleId = null;
      readingState = null;
      outline = [];
    }
  }

  async function openArticle(articleId: string): Promise<void> {
    const article = articles.find((entry) => entry.id === articleId);
    if (!article) {
      return;
    }

    selectedArticle = await hydrateArticleAssets(article);
    selectedArticleId = article.id;
    readingState = (await loadReadingState(article.id)) ?? null;
  }

  async function handleManifestPreview(): Promise<void> {
    manifestBusy = true;
    manifestError = '';
    preview = null;

    try {
      preview = await previewManifest(manifestUrl.trim());
    } catch (error) {
      manifestError = error instanceof Error ? error.message : 'Failed to preview manifest.';
    } finally {
      manifestBusy = false;
    }
  }

  async function handleManifestSave(): Promise<void> {
    if (!preview) {
      return;
    }

    manifestBusy = true;
    manifestError = '';

    try {
      await saveManifestSource(preview);
      await refreshGroups();
      await selectGroup(preview.group.id);
      setMessage(`Added "${preview.group.title}" to the bookshelf.`);
      preview = null;
      manifestUrl = '';
    } catch (error) {
      manifestError = error instanceof Error ? error.message : 'Failed to save manifest source.';
    } finally {
      manifestBusy = false;
    }
  }

  async function handleDownloadAll(): Promise<void> {
    if (!selectedGroupId) {
      return;
    }

    setMessage('Downloading markdown articles...');
    await downloadGroup(selectedGroupId);
    articles = await loadArticles(selectedGroupId);
    await refreshGroups();
    if (selectedArticleId) {
      await openArticle(selectedArticleId);
    }
    setMessage('Download finished. Failed items can be retried from the directory.');
  }

  async function handleRetryFailed(): Promise<void> {
    if (!selectedGroupId) {
      return;
    }

    await retryFailedArticles(selectedGroupId);
    articles = await loadArticles(selectedGroupId);
    await refreshGroups();
    if (selectedArticleId) {
      await openArticle(selectedArticleId);
    }
    setMessage('Retried failed article downloads.');
  }

  async function handleSaveProgress(payload: {
    articleId: string;
    groupId: string;
    scrollPosition: number;
    progressRatio: number;
  }): Promise<void> {
    await saveReadingProgress(payload);
    readingState = (await loadReadingState(payload.articleId)) ?? null;
    await refreshGroups();
  }

  async function handleToggleFavorite(value: boolean): Promise<void> {
    if (!selectedArticle || !selectedGroupId || !selectedArticleId) {
      return;
    }

    if ('isTemporary' in selectedArticle) {
      return;
    }

    await toggleFavorite(selectedArticleId, selectedGroupId, value);
    readingState = (await loadReadingState(selectedArticleId)) ?? null;
  }

  function openImportPicker(): void {
    fileInput?.click();
  }

  async function handleLocalImport(event: Event): Promise<void> {
    const target = event.currentTarget as HTMLInputElement;
    const files = Array.from(target.files ?? []);
    target.value = '';

    if (files.length === 0) {
      return;
    }

    if (files.length === 1) {
      const file = files[0];
      if (!file) {
        return;
      }

      const tempArticle = await openSingleLocalFile(file);
      selectedArticle = tempArticle;
      selectedArticleId = tempArticle.id;
      readingState = null;
      outline = [];
      setMessage(`Opened temporary article "${tempArticle.title}". Import it when ready.`);
      return;
    }

    const groupId = await importLocalFiles(files);
    await refreshGroups();
    await selectGroup(groupId);
    setMessage(`Imported ${files.length} markdown files into your bookshelf.`);
  }

  async function handleImportTemporary(article: TemporaryArticle): Promise<void> {
    const groupId = await saveTemporaryArticle(article);
    await refreshGroups();
    await selectGroup(groupId);
    setMessage(`Saved "${article.title}" to the bookshelf.`);
  }

  async function handleDroppedFiles(files: File[]): Promise<void> {
    if (files.length === 0) {
      setMessage('No markdown files found. Drop .md files to import.', 'error');
      return;
    }

    if (files.length === 1) {
      const file = files[0]!;
      const tempArticle = await openSingleLocalFile(file);
      selectedArticle = tempArticle;
      selectedArticleId = tempArticle.id;
      readingState = null;
      outline = [];
      setMessage(`Opened temporary article "${tempArticle.title}". Import it when ready.`);
      return;
    }

    const groupId = await importLocalFiles(files);
    await refreshGroups();
    await selectGroup(groupId);
    setMessage(`Imported ${files.length} markdown files into your bookshelf.`);
  }

  async function handleRemoveGroup(groupId: string): Promise<void> {
    await removeGroup(groupId);
    if (selectedGroupId === groupId) {
      selectedGroupId = null;
      selectedGroup = null;
      articles = [];
      selectedArticle = null;
      selectedArticleId = null;
      readingState = null;
      outline = [];
    }
    await refreshGroups();
    setMessage('Group removed.');
  }

  async function handleThemeChange(theme: ThemeMode): Promise<void> {
    settings = { ...settings, theme };
    saveSettings(settings);
    applyTheme(theme);
  }

  async function handleFontSizeChange(fontSize: number): Promise<void> {
    settings = { ...settings, fontSize: normalizeFontSize(fontSize) };
    saveSettings(settings);
  }

  async function handleClearData(): Promise<void> {
    await clearAllData();
    groups = [];
    articles = [];
    selectedGroup = null;
    selectedGroupId = null;
    selectedArticle = null;
    selectedArticleId = null;
    readingState = null;
    preview = null;
    outline = [];
    setMessage('Local cache cleared.');
  }

  async function toggleFocusMode(): Promise<void> {
    if (!focusController) {
      const { createFocusMode } = await import('./lib/focus-mode');
      focusController = createFocusMode((active) => {
        focusMode = active;
      });
    }
    focusController.toggle();
  }

  async function handleLaunchQueue(): Promise<void> {
    if (!('launchQueue' in window)) {
      return;
    }

    (window as any).launchQueue.setConsumer(async (launchParams: any) => {
      const handles: FileSystemFileHandle[] = launchParams.files ?? [];
      if (handles.length === 0) {
        return;
      }

      const files: File[] = [];
      for (const handle of handles) {
        const file = await handle.getFile();
        if (file.name.endsWith('.md')) {
          files.push(file);
        }
      }

      if (files.length === 0) {
        return;
      }

      if (files.length === 1) {
        const tempArticle = await openSingleLocalFile(files[0]!);
        selectedArticle = tempArticle;
        selectedArticleId = tempArticle.id;
        readingState = null;
        outline = [];
        setMessage(`Opened "${tempArticle.title}" from file handler. Import it when ready.`);
        return;
      }

      const groupId = await importLocalFiles(files);
      await refreshGroups();
      await selectGroup(groupId);
      setMessage(`Imported ${files.length} markdown files into your bookshelf.`);
    });
  }

  onMount(async () => {
    applyTheme(settings.theme);
    await refreshGroups();

    window.addEventListener('online', () => {
      online = true;
    });
    window.addEventListener('offline', () => {
      online = false;
    });

    const firstGroup = groups[0];
    if (firstGroup) {
      await selectGroup(firstGroup.id);
    }

    await handleLaunchQueue();
  });

  onDestroy(() => {
    focusController?.destroy();
  });
</script>

<svelte:window on:keydown={(e) => { if (e.key === 'F11') { e.preventDefault(); toggleFocusMode(); } }} />

<svelte:head>
  <title>My MD Reader</title>
</svelte:head>

<input
  bind:this={fileInput}
  type="file"
  accept=".md,text/markdown"
  multiple
  hidden
  on:change={handleLocalImport}
/>

<div class="app-shell" class:focus-active={focusMode} use:dropImport={{ onDrop: handleDroppedFiles, onDragChange: (v) => (dragging = v) }}>
  {#if dragging}
    <div class="drop-overlay">
      <div class="drop-prompt">
        <span class="drop-icon">+</span>
        <p>Drop markdown files to import</p>
      </div>
    </div>
  {/if}

  <header class="topbar">
    <div>
      <span class="eyebrow">Offline-first markdown reader</span>
      <h1>My MD Reader</h1>
    </div>
    <div class="topbar-actions">
      <span class:offline={!online} class="network-dot" title={online ? 'Online' : 'Offline'}></span>
      <button on:click={() => (showDirectory = !showDirectory)}>Directory</button>
      <button on:click={() => (showSettings = !showSettings)}>Settings</button>
      <button class="focus-btn" on:click={toggleFocusMode}>Focus</button>
    </div>
  </header>

  {#if message}
    <p class:info={messageTone === 'info'} class:error={messageTone === 'error'} class="notice">{message}</p>
  {/if}

  <main class="layout">
    <aside class:panel-hidden={!showDirectory} class="left-column">
      <Bookshelf
        {groups}
        {selectedGroupId}
        onSelectGroup={selectGroup}
        onImportLocal={openImportPicker}
        onRemoveGroup={handleRemoveGroup}
      />

      <AddSourceForm
        {manifestUrl}
        {preview}
        busy={manifestBusy}
        error={manifestError}
        onUrlChange={(value) => {
          manifestUrl = value;
        }}
        onPreview={handleManifestPreview}
        onSave={handleManifestSave}
      />

      <GroupDetail
        group={selectedGroup}
        {articles}
        {selectedArticleId}
        onSelectArticle={openArticle}
        onDownloadAll={handleDownloadAll}
        onRetryFailed={handleRetryFailed}
      />
    </aside>

    <section class="reader-column">
      <ReaderPane
        article={selectedArticle}
        {readingState}
        fontSize={settings.fontSize}
        {online}
        onSaveProgress={handleSaveProgress}
        onToggleFavorite={handleToggleFavorite}
        onOutlineChange={(headings) => {
          outline = headings;
        }}
        onImportTemporary={handleImportTemporary}
      />
    </section>

    <aside class:panel-hidden={!showSettings} class="right-column">
      <SettingsPanel
        {settings}
        onThemeChange={handleThemeChange}
        onFontSizeChange={handleFontSizeChange}
        onClearData={handleClearData}
      />

      <section class="outline-card">
        <h2>Outline</h2>
        {#if outline.length > 0}
          <ul>
            {#each outline as heading}
              <li class={`level-${heading.level}`}>
                <a href={`#${heading.id}`}>{heading.text}</a>
              </li>
            {/each}
          </ul>
        {:else}
          <p>No headings found for this article.</p>
        {/if}
      </section>
    </aside>
  </main>

  {#if showDirectory || showSettings}
    <button class="mobile-backdrop" on:click={() => { showDirectory = false; showSettings = false; }} aria-label="Close panel"></button>
  {/if}

  {#if focusMode}
    <button class="exit-focus" on:click={toggleFocusMode} title="Exit focus mode">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 11H1v6h6v-3M14 7h3V1h-6v3M7 1L1 7M11 17l6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  {/if}

  <div class="mobile-fab-group">
    <button class="mobile-fab" class:active={showDirectory} on:click={() => { showDirectory = !showDirectory; if (showDirectory) showSettings = false; }} aria-label="Toggle directory">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 4h14M3 8h14M3 12h10M3 16h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
    <button class="mobile-fab" class:active={showSettings} on:click={() => { showSettings = !showSettings; if (showSettings) showDirectory = false; }} aria-label="Toggle settings">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" stroke-width="1.5"/><path d="M16.2 12.2a1.2 1.2 0 00.2 1.3l.04.04a1.5 1.5 0 11-2.12 2.12l-.04-.04a1.2 1.2 0 00-1.3-.2 1.2 1.2 0 00-.73 1.1v.1a1.5 1.5 0 11-3 0v-.06a1.2 1.2 0 00-.78-1.1 1.2 1.2 0 00-1.3.2l-.04.04a1.5 1.5 0 11-2.12-2.12l.04-.04a1.2 1.2 0 00.2-1.3 1.2 1.2 0 00-1.1-.73h-.1a1.5 1.5 0 110-3h.06a1.2 1.2 0 001.1-.78 1.2 1.2 0 00-.2-1.3l-.04-.04A1.5 1.5 0 117.05 4.22l.04.04a1.2 1.2 0 001.3.2h.06a1.2 1.2 0 00.73-1.1v-.1a1.5 1.5 0 113 0v.06a1.2 1.2 0 00.78 1.1 1.2 1.2 0 001.3-.2l.04-.04a1.5 1.5 0 112.12 2.12l-.04.04a1.2 1.2 0 00-.2 1.3v.06a1.2 1.2 0 001.1.73h.1a1.5 1.5 0 110 3h-.06a1.2 1.2 0 00-1.1.78z" stroke="currentColor" stroke-width="1.5"/></svg>
    </button>
  </div>
</div>

<style>
  .app-shell {
    padding: 1.25rem;
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .topbar h1 {
    margin: 0.15rem 0 0;
    font-size: clamp(1.5rem, 2.5vw, 2rem);
    letter-spacing: -0.02em;
    color: var(--text-main);
  }

  .eyebrow {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    font-weight: 600;
  }

  .topbar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }

  .topbar-actions button {
    border-radius: 999px;
    border: 1px solid var(--border-light);
    padding: 0.5rem 1rem;
    background: var(--bg-panel);
    color: var(--text-main);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .topbar-actions button:hover {
    background: var(--bg-hover);
  }

  .network-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #22c55e;
    flex-shrink: 0;
  }

  .network-dot.offline {
    background: #9ca3af;
  }

  .focus-btn {
    display: none;
  }

  @media (min-width: 1101px) {
    .focus-btn {
      display: inline-flex;
      border-radius: 999px;
      border: 1px solid var(--border-light);
      padding: 0.5rem 1rem;
      background: var(--bg-panel);
      color: var(--text-main);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
    }

    .focus-btn:hover {
      background: var(--bg-hover);
    }
  }

  .focus-active .topbar,
  .focus-active .notice,
  .focus-active .mobile-fab-group,
  .focus-active .mobile-backdrop {
    display: none;
  }

  .focus-active .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .focus-active .left-column,
  .focus-active .right-column {
    display: none;
  }

  .focus-active {
    padding: 0;
  }

  .focus-active .reader-column {
    max-width: 52rem;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .exit-focus {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 300;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 50%;
    border: 1px solid var(--border-light);
    background: var(--bg-panel);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-md);
    cursor: pointer;
    opacity: 0.4;
    transition: opacity 0.2s;
  }

  .exit-focus:hover {
    opacity: 1;
    color: var(--text-main);
  }

  .notice {
    margin: 0 0 1rem;
    padding: 0.8rem 1rem;
    border-radius: 0.75rem;
    font-size: 0.95rem;
  }

  .notice.info {
    background: var(--accent-soft);
    color: var(--text-main);
  }

  .notice.error {
    background: var(--danger-soft);
    color: var(--danger-text);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(18rem, 20rem) minmax(0, 1fr) minmax(15rem, 18rem);
    gap: 1.5rem;
    align-items: start;
  }

  .left-column,
  .right-column {
    display: grid;
    gap: 1.5rem;
  }

  .reader-column {
    min-width: 0;
  }

  .outline-card {
    padding: 1.25rem;
    border-radius: 1rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-light);
    box-shadow: var(--shadow-sm);
  }

  .outline-card h2 {
    font-size: 1.1rem;
    margin-bottom: 0.5rem;
  }

  .outline-card ul {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
    display: grid;
    gap: 0.5rem;
  }

  .outline-card li {
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .outline-card .level-2 {
    padding-left: 0.75rem;
  }

  .outline-card .level-3 {
    padding-left: 1.5rem;
  }

  .outline-card a {
    color: inherit;
    text-decoration: none;
  }

  .outline-card a:hover {
    color: var(--accent);
  }

  .outline-card p {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-top: 0.5rem;
  }

  .drop-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .drop-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2.5rem 3.5rem;
    border: 2px dashed var(--accent);
    border-radius: 1.5rem;
    background: var(--bg-panel);
    box-shadow: var(--shadow-sm);
  }

  .drop-icon {
    font-size: 2.5rem;
    font-weight: 700;
    color: var(--accent);
    line-height: 1;
  }

  .drop-prompt p {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 500;
    color: var(--text-main);
  }

  .mobile-backdrop {
    display: none;
  }

  .mobile-fab-group {
    display: none;
  }

  @media (max-width: 1100px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .left-column,
    .right-column {
      position: fixed;
      top: 0;
      bottom: 0;
      width: min(85vw, 22rem);
      z-index: 200;
      background: var(--bg-app);
      overflow-y: auto;
      padding: 1.25rem;
      box-shadow: var(--shadow-md);
      transition: transform 0.25s ease;
    }

    .left-column {
      left: 0;
    }

    .right-column {
      right: 0;
    }

    .left-column.panel-hidden {
      transform: translateX(-100%);
      pointer-events: none;
    }

    .right-column.panel-hidden {
      transform: translateX(100%);
      pointer-events: none;
    }

    .mobile-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 150;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(2px);
      border: none;
      padding: 0;
      cursor: default;
    }

    .mobile-fab-group {
      display: flex;
      gap: 0.75rem;
      position: fixed;
      bottom: 1.25rem;
      right: 1.25rem;
      z-index: 100;
    }

    .mobile-fab {
      width: 3rem;
      height: 3rem;
      border-radius: 50%;
      border: 1px solid var(--border-light);
      background: var(--bg-panel);
      color: var(--text-main);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-md);
    }

    .mobile-fab.active {
      background: var(--accent);
      color: var(--text-inverse);
      border-color: transparent;
    }
  }

  @media (min-width: 1101px) {
    .topbar-actions button:not(.focus-btn) {
      display: none;
    }
  }
</style>
