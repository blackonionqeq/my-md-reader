<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { useRegisterSW } from 'virtual:pwa-register/svelte';
  import AddSourceForm from './components/AddSourceForm.svelte';
  import Bookshelf from './components/Bookshelf.svelte';
  import GroupDetail from './components/GroupDetail.svelte';
  import ManifestHelpDialog from './components/ManifestHelpDialog.svelte';
  import ReaderPane from './components/ReaderPane.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import UpdatePrompt from './components/UpdatePrompt.svelte';
  import {
    clearAllData,
    downloadGroup,
    type DownloadProgress,
    hydrateArticleAssets,
    importLocalFiles,
    loadArticles,
    loadGroups,
    loadReadingState,
    migrateLegacyAssetsInBackground,
    openSingleLocalFile,
    previewManifest,
    previewUrlArticle,
    recordArticleImageFailure,
    removeGroup,
    retryFailedArticles,
    saveManifestSource,
    saveReadingProgress,
    saveTemporaryArticle,
    saveUrlArticle
  } from './lib/content-service';
  import { dropImport } from './lib/drop-import';
  import type { FocusModeController } from './lib/focus-mode';
  import { isServiceWorkerControllingPage } from './lib/image-cache';
  import { applyTheme, clearLastOpened, loadLastOpened, loadSettings, normalizeFontSize, saveDirectoryScroll, saveLastOpened, saveSettings } from './lib/settings';
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
    ThemeMode,
    UrlArticlePreview
  } from './lib/types';

  let manifestUrl = '';
  let preview: ManifestPreview | null = null;
  let urlPreview: UrlArticlePreview | null = null;
  let manifestBusy = false;
  let manifestError = '';

  let groups: GroupListItem[] = [];
  let selectedGroup: Group | null = null;
  let selectedGroupId: string | null = null;
  let articles: Article[] = [];
  let selectedArticle: ReaderArticle | null = null;
  let selectedArticleId: string | null = null;
  let readingState: ReadingState | null = null;
  let restoreScrollPosition = false;
  let settings: ReaderSettings = loadSettings();
  let fileInput: HTMLInputElement | null = null;
  let online = typeof navigator === 'undefined' ? true : navigator.onLine;
  let outline: OutlineHeading[] = [];
  let message = '';
  let messageTone: 'info' | 'error' = 'info';
  let showOutline = false;
  let showDirectory = false;
  let showAddForm = false;
  let showManifestHelp = false;
  let dragging = false;
  let downloading = false;
  let focusMode = false;
  let focusController: FocusModeController | null = null;
  let directoryWrapper: HTMLDivElement | null = null;
  let restoringDirectoryScroll = false;
  let swControlled = isServiceWorkerControllingPage();
  let imageMigrationRunning = false;

  let messageTimer: number | undefined;

  const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      swControlled = isServiceWorkerControllingPage();
      console.info('[pwa] service worker registered', {
        swUrl,
        scope: registration?.scope,
        controlled: swControlled,
        appVersion: __APP_VERSION__,
        buildTime: __BUILD_TIME__
      });
    },
    onRegisterError(error) {
      console.error('[pwa] service worker registration failed', {
        error,
        appVersion: __APP_VERSION__,
        buildTime: __BUILD_TIME__
      });
      setMessage('Offline service failed to start. Reload while online to retry.', 'error');
    }
  });

  function setMessage(value: string, tone: 'info' | 'error' = 'info'): void {
    message = value;
    messageTone = tone;

    if (messageTimer) {
      window.clearTimeout(messageTimer);
      messageTimer = undefined;
    }
    if (value) {
      messageTimer = window.setTimeout(() => {
        // Keep the notice visible while a download is in flight — the mobile
        // toast mirrors it and progress updates will reset the timer anyway.
        if (!downloading) {
          message = '';
        }
        messageTimer = undefined;
      }, 3000);
    }
  }

  async function runImageMigration(): Promise<void> {
    if (imageMigrationRunning) {
      return;
    }

    imageMigrationRunning = true;
    try {
      await migrateLegacyAssetsInBackground();
    } catch (error) {
      console.error('[image-cache] background migration failed', {
        controlled: swControlled,
        appVersion: __APP_VERSION__,
        buildTime: __BUILD_TIME__,
        error
      });
    } finally {
      imageMigrationRunning = false;
    }
  }

  function handleControllerChange(): void {
    swControlled = isServiceWorkerControllingPage();
    if (swControlled) {
      void runImageMigration();
    }
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
    showDirectory = false;
    showOutline = true;
    if (directoryWrapper) directoryWrapper.scrollTop = 0;

    if (selectedArticleId && articles.some((article) => article.id === selectedArticleId)) {
      return;
    }

    const defaultArticle =
      articles.find((article) => article.id === selectedGroup?.lastReadArticleId)
      ?? articles.find((article) => article.downloadStatus === 'downloaded')
      ?? articles[0];

    if (defaultArticle) {
      await openArticle(defaultArticle.id, { restoreScroll: true });
    } else {
      selectedArticle = null;
      selectedArticleId = null;
      readingState = null;
      outline = [];
    }
  }

  async function openArticle(
    articleId: string,
    options: { restoreScroll?: boolean } = {}
  ): Promise<void> {
    const article = articles.find((entry) => entry.id === articleId);
    if (!article) {
      return;
    }

    // Resolve state before assigning the article so the reader renders with the
    // matching reading state and scroll intent in a single flush, avoiding a
    // stale readingState from the previously open article.
    const nextReadingState = (await loadReadingState(article.id)) ?? null;
    const nextArticle = await hydrateArticleAssets(article);
    restoreScrollPosition = Boolean(options.restoreScroll);
    readingState = nextReadingState;
    selectedArticle = nextArticle;
    selectedArticleId = article.id;

    if (selectedGroupId) {
      saveLastOpened(selectedGroupId, article.id);
    }
  }

  async function handleSelectArticle(articleId: string): Promise<void> {
    const switching = articleId !== selectedArticleId;
    await openArticle(articleId);
    // Dismiss the slide-over directory panel after switching articles so the
    // reader is immediately visible (no-op on desktop where the column persists).
    if (switching) {
      showOutline = false;
    }
  }

  async function handleSourcePreview(): Promise<void> {
    manifestBusy = true;
    manifestError = '';
    preview = null;
    urlPreview = null;

    const url = manifestUrl.trim();

    try {
      preview = await previewManifest(url);
    } catch {
      try {
        urlPreview = await previewUrlArticle(url);
      } catch (error) {
        manifestError = error instanceof Error ? error.message : 'Failed to fetch URL.';
      }
    } finally {
      manifestBusy = false;
    }
  }

  async function handleSourceSave(): Promise<void> {
    manifestBusy = true;
    manifestError = '';

    try {
      if (urlPreview) {
        const groupId = await saveUrlArticle(urlPreview);
        await refreshGroups();
        await selectGroup(groupId);
        setMessage(`Imported "${urlPreview.title}" to the bookshelf.`);
        urlPreview = null;
        manifestUrl = '';
      } else if (preview) {
        await saveManifestSource(preview);
        await refreshGroups();
        await selectGroup(preview.group.id);
        setMessage(`Added "${preview.group.title}" to the bookshelf.`);
        preview = null;
        manifestUrl = '';
      }
    } catch (error) {
      manifestError = error instanceof Error ? error.message : 'Failed to save source.';
    } finally {
      manifestBusy = false;
    }
  }

  function formatDownloadProgress(progress: DownloadProgress): string {
    let msg = `Downloading article ${progress.articleIndex}/${progress.articleTotal}`;
    if (progress.assetTotal) {
      msg += ` — image ${progress.assetIndex}/${progress.assetTotal}`;
    }
    return msg + '…';
  }

  async function handleDownloadAll(): Promise<void> {
    if (!selectedGroupId) {
      return;
    }

    downloading = true;
    setMessage('Downloading…');
    try {
      await downloadGroup(selectedGroupId, undefined, (progress) => {
        setMessage(formatDownloadProgress(progress));
      });
    } finally {
      downloading = false;
    }
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
    const lastOpened = loadLastOpened();
    if (lastOpened?.groupId === groupId) {
      clearLastOpened();
    }
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
    clearLastOpened();
    groups = [];
    articles = [];
    selectedGroup = null;
    selectedGroupId = null;
    selectedArticle = null;
    selectedArticleId = null;
    readingState = null;
    preview = null;
    urlPreview = null;
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

    console.info('[app] release diagnostics', {
      appVersion: __APP_VERSION__,
      buildTime: __BUILD_TIME__,
      serviceWorkerControlled: swControlled
    });

    window.addEventListener('online', () => {
      online = true;
    });
    window.addEventListener('offline', () => {
      online = false;
    });
    navigator.serviceWorker?.addEventListener('controllerchange', handleControllerChange);

    // Reopen the last-viewed group and article so the user picks up where
    // they left off.  selectGroup already opens the group's lastReadArticle
    // internally, so we only call openArticle a second time when the
    // last-opened article differs — otherwise the redundant call causes a
    // double render that can race with scroll restoration.
    const lastOpened = loadLastOpened();
    const restoreGroup = lastOpened
      ? groups.find((g) => g.id === lastOpened.groupId)
      : null;

    if (restoreGroup) {
      await selectGroup(restoreGroup.id);
      if (lastOpened && selectedArticleId !== lastOpened.articleId && articles.some((a) => a.id === lastOpened.articleId)) {
        await openArticle(lastOpened.articleId, { restoreScroll: true });
      }
      if (lastOpened?.directoryScrollTop && directoryWrapper) {
        restoringDirectoryScroll = true;
        await tick();
        directoryWrapper.scrollTop = lastOpened.directoryScrollTop;
        restoringDirectoryScroll = false;
      }
    } else {
      const firstGroup = groups[0];
      if (firstGroup) {
        await selectGroup(firstGroup.id);
      }
    }

    await handleLaunchQueue();
    void runImageMigration();
  });

  onDestroy(() => {
    focusController?.destroy();
    if (messageTimer) {
      window.clearTimeout(messageTimer);
    }
    navigator.serviceWorker?.removeEventListener('controllerchange', handleControllerChange);
  });

  function navigateArticle(direction: -1 | 1): void {
    if (!selectedArticleId || articles.length === 0) return;
    const idx = articles.findIndex((a) => a.id === selectedArticleId);
    if (idx === -1) return;
    const next = idx + direction;
    if (next < 0 || next >= articles.length) return;
    openArticle(articles[next]!.id);
  }

  $: currentArticleIndex = selectedArticleId
    ? articles.findIndex((a) => a.id === selectedArticleId)
    : -1;
  $: previousArticleTitle =
    currentArticleIndex > 0 ? (articles[currentArticleIndex - 1]?.title ?? null) : null;
  $: nextArticleTitle =
    currentArticleIndex >= 0 && currentArticleIndex < articles.length - 1
      ? (articles[currentArticleIndex + 1]?.title ?? null)
      : null;
</script>

<svelte:window on:keydown={(e) => {
  if (e.key === 'F11') { e.preventDefault(); toggleFocusMode(); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
    navigateArticle(e.key === 'ArrowLeft' ? -1 : 1);
  }
}} />

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
    <div class="topbar-brand">
      <h1>My MD Reader</h1>
      <span class="eyebrow">Offline-first markdown reader</span>
    </div>
    <div class="topbar-actions">
      <span
        class:offline={!online}
        class="network-dot"
        title={`${online ? 'Online' : 'Offline'} · app ${__APP_VERSION__} · ${swControlled ? 'offline service active' : 'offline service not controlling this page'}`}
      ></span>
      <button class="focus-btn" on:click={toggleFocusMode}>Focus</button>
    </div>
  </header>

  {#if message}
    <p class:info={messageTone === 'info'} class:error={messageTone === 'error'} class="notice">{message}</p>
  {/if}

  <main class="layout">
    <aside class:panel-hidden={!showDirectory} class="left-column">
      <button class="drawer-toggle" on:click={() => (showAddForm = !showAddForm)}>
        <span>Add from URL</span>
        <span class="chevron" class:open={showAddForm}>&#9656;</span>
      </button>
      {#if showAddForm}
        <AddSourceForm
          {manifestUrl}
          {preview}
          {urlPreview}
          busy={manifestBusy}
          error={manifestError}
          onUrlChange={(value) => {
            manifestUrl = value;
          }}
          onPreview={handleSourcePreview}
          onSave={handleSourceSave}
          onManifestHelp={() => (showManifestHelp = true)}
        />
      {/if}

      <details class="settings-drawer">
        <summary>Settings</summary>
        <div class="settings-content">
          <SettingsPanel
            {settings}
            onThemeChange={handleThemeChange}
            onFontSizeChange={handleFontSizeChange}
            onClearData={handleClearData}
          />
        </div>
      </details>

      <div class="bookshelf-wrapper">
        <Bookshelf
          {groups}
          {selectedGroupId}
          onSelectGroup={selectGroup}
          onImportLocal={openImportPicker}
          onRemoveGroup={handleRemoveGroup}
        />
      </div>
    </aside>

    <section class="reader-column">
      <ReaderPane
        article={selectedArticle}
        {readingState}
        restoreScrollPosition={restoreScrollPosition}
        fontSize={settings.fontSize}
        {online}
        onSaveProgress={handleSaveProgress}
        onOutlineChange={(headings) => {
          outline = headings;
        }}
        onImageError={({ articleId, src, reason }) => {
          void recordArticleImageFailure(articleId, src, reason);
        }}
        onImportTemporary={handleImportTemporary}
        onNavigatePrevious={previousArticleTitle != null ? () => navigateArticle(-1) : null}
        onNavigateNext={nextArticleTitle != null ? () => navigateArticle(1) : null}
        previousTitle={previousArticleTitle}
        nextTitle={nextArticleTitle}
      />
    </section>

    <aside class:panel-hidden={!showOutline} class="right-column">
      <div class="group-detail-wrapper" bind:this={directoryWrapper} on:scroll={() => { if (directoryWrapper && !restoringDirectoryScroll) saveDirectoryScroll(directoryWrapper.scrollTop); }}>
        <GroupDetail
          group={selectedGroup}
          {articles}
          {selectedArticleId}
          onSelectArticle={handleSelectArticle}
          onDownloadAll={handleDownloadAll}
          onRetryFailed={handleRetryFailed}
        />
      </div>

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

  {#if showDirectory || showOutline}
    <button class="mobile-backdrop" on:click={() => { showDirectory = false; showOutline = false; }} aria-label="Close panel"></button>
  {/if}

  {#if focusMode}
    <button class="exit-focus" on:click={toggleFocusMode} title="Exit focus mode">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 11H1v6h6v-3M14 7h3V1h-6v3M7 1L1 7M11 17l6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  {/if}

  <div class="mobile-fab-group">
    <button class="mobile-fab" class:active={showDirectory} on:click={() => { showDirectory = !showDirectory; if (showDirectory) showOutline = false; }} aria-label="Toggle directory">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 4h14M3 8h14M3 12h10M3 16h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
    <button class="mobile-fab" class:active={showOutline} on:click={() => { showOutline = !showOutline; if (showOutline) showDirectory = false; }} aria-label="Toggle outline">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 4h14M5 8h12M7 12h10M5 16h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
  </div>

  {#if downloading}
    <div class="download-toast">{message}</div>
  {/if}

  <ManifestHelpDialog open={showManifestHelp} onClose={() => (showManifestHelp = false)} />
</div>

<UpdatePrompt
  offlineReady={$offlineReady}
  needRefresh={$needRefresh}
  onReload={() => void updateServiceWorker(true)}
  onDismiss={() => {
    offlineReady.set(false);
    needRefresh.set(false);
  }}
/>

<style>
  .app-shell {
    padding: 0.75rem 1.25rem;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .topbar-brand {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  .topbar h1 {
    margin: 0;
    font-size: 1.35rem;
    letter-spacing: -0.02em;
    color: var(--text-main);
  }

  .eyebrow {
    font-size: 0.65rem;
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
  .focus-active .mobile-backdrop,
  .focus-active :global(.scroll-top-fab) {
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
    width: 75vw;
    margin: 0 auto;
    padding: 0.5rem 1.5rem 2rem;
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
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.9rem;
    border-left: 3px solid transparent;
  }

  .notice.info {
    background: var(--accent-soft);
    border-left-color: var(--accent);
    color: var(--text-main);
  }

  .notice.error {
    background: var(--danger-soft);
    border-left-color: var(--danger);
    color: var(--danger-text);
  }

  .layout {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr) minmax(18rem, 22rem);
    grid-template-rows: minmax(0, 1fr);
    gap: 1.5rem;
  }

  .left-column {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
    overflow: hidden;
  }

  .bookshelf-wrapper {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .right-column {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 0;
    overflow: hidden;
  }

  .group-detail-wrapper {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .reader-column {
    min-width: 0;
    min-height: 0;
  }

  .outline-card {
    padding: 1.25rem;
    border-radius: 1rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-light);
    box-shadow: var(--shadow-sm);
    max-height: 25vh;
    overflow-y: auto;
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

  .drawer-toggle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 0.75rem 1.25rem;
    border-radius: 0.75rem;
    border: 1px solid var(--border-light);
    background: var(--bg-panel);
    color: var(--text-muted);
    font-size: 0.9rem;
    font-weight: 500;
  }

  .drawer-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-main);
  }

  .chevron {
    display: inline-block;
    transition: transform 0.2s ease;
    font-size: 0.75rem;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .settings-drawer {
    border-radius: 0.75rem;
    border: 1px solid var(--border-light);
    background: var(--bg-panel);
    overflow: hidden;
  }

  .settings-drawer summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1.25rem;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    list-style: none;
  }

  .settings-drawer summary::-webkit-details-marker {
    display: none;
  }

  .settings-drawer summary::after {
    content: '▸';
    font-size: 0.75rem;
    transition: transform 0.2s ease;
  }

  .settings-drawer[open] summary::after {
    transform: rotate(90deg);
  }

  .settings-drawer summary:hover {
    background: var(--bg-hover);
    color: var(--text-main);
  }

  .settings-content {
    padding: 0 0.25rem 0.25rem;
  }

  .settings-content :global(.card) {
    border: none;
    box-shadow: none;
    border-radius: 0 0 0.75rem 0.75rem;
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

  .download-toast {
    display: none;
  }

  @media (max-width: 1100px) {
    .topbar-brand {
      flex-wrap: wrap;
    }

    .eyebrow {
      display: none;
    }

    .app-shell {
      height: auto;
      overflow: visible;
    }

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

    .download-toast {
      display: block;
      position: fixed;
      bottom: 5rem;
      left: 1rem;
      right: 1rem;
      padding: 0.625rem 1rem;
      background: var(--bg-panel);
      border: 1px solid var(--border-light);
      border-left: 3px solid var(--accent);
      border-radius: 0.5rem;
      box-shadow: var(--shadow-md);
      font-size: 0.85rem;
      color: var(--text-main);
      z-index: 300;
      text-align: center;
    }
  }

  @media (max-width: 900px) {
    .app-shell {
      padding: 0.75rem;
    }
  }

  @media (min-width: 1101px) {
    .topbar-actions button:not(.focus-btn) {
      display: none;
    }
  }
</style>
