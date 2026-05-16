<script lang="ts">
  import { onMount } from 'svelte';
  import AddSourceForm from './components/AddSourceForm.svelte';
  import Bookshelf from './components/Bookshelf.svelte';
  import GroupDetail from './components/GroupDetail.svelte';
  import ReaderPane from './components/ReaderPane.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import {
    clearAllData,
    downloadGroup,
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

    selectedArticle = article;
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
  });
</script>

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

<div class="app-shell">
  <header class="topbar">
    <div>
      <span class="eyebrow">Offline-first markdown reader</span>
      <h1>My MD Reader</h1>
    </div>
    <div class="topbar-actions">
      <span class:offline={!online} class="network">{online ? 'Online' : 'Offline'}</span>
      <button on:click={() => (showDirectory = !showDirectory)}>Directory</button>
      <button on:click={() => (showSettings = !showSettings)}>Settings</button>
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

  .topbar-actions button,
  .network {
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

  .network.offline {
    background: var(--danger-soft);
    color: var(--danger-text);
    border-color: transparent;
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

  @media (max-width: 1100px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .left-column,
    .right-column {
      position: static;
    }

    .panel-hidden {
      display: none;
    }
  }

  @media (min-width: 1101px) {
    .topbar-actions button {
      display: none;
    }
  }
</style>
