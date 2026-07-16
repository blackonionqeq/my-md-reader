import { db } from './db';
import { createId } from './id';
import {
  deleteCachedImage,
  deleteImageCache,
  deleteObsoleteImageCaches,
  fetchAndCacheImage,
  isServiceWorkerControllingPage,
  matchCachedImage,
  migrateLegacyBlobToImageCache,
  reconcileImageCache
} from './image-cache';
import { normalizeManifestPreview, validateManifest } from './manifest';
import type {
  Article,
  Asset,
  AssetStatus,
  GroupListItem,
  ManifestPreview,
  ReadingState,
  TemporaryArticle,
  UrlArticlePreview
} from './types';

export type DownloadProgress = {
  articleIndex: number;
  articleTotal: number;
  assetIndex?: number;
  assetTotal?: number;
};

const MAX_ASSET_RETRY_ATTEMPTS = 5;
const ASSET_RETRY_DELAYS_MS = [1000, 3000, 10000, 30000];
const ASSET_PLACEHOLDER_PREFIX = 'mdr-asset://';
const ASSET_MARKDOWN_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const ASSET_PLACEHOLDER_PATTERN = new RegExp(`${escapeRegExp(ASSET_PLACEHOLDER_PREFIX)}([^)\\s]+)`, 'g');

function createAssetPlaceholder(assetId: string): string {
  return `${ASSET_PLACEHOLDER_PREFIX}${assetId}`;
}

function isRemoteImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function computeNextRetryAt(attemptCount: number, now = Date.now()): string | undefined {
  if (attemptCount >= MAX_ASSET_RETRY_ATTEMPTS) {
    return undefined;
  }

  const delay = ASSET_RETRY_DELAYS_MS[Math.max(0, attemptCount - 1)];
  if (!delay) {
    return undefined;
  }

  return new Date(now + delay).toISOString();
}

export function extractMarkdownImageUrls(content: string, articleUrl: string): Array<{ original: string; resolved: string }> {
  const matches = Array.from(content.matchAll(ASSET_MARKDOWN_PATTERN));
  const deduped = new Map<string, { original: string; resolved: string }>();

  for (const match of matches) {
    const original = match[2]?.trim();
    if (!original) {
      continue;
    }

    let resolved: string;
    try {
      resolved = new URL(original, articleUrl).toString();
    } catch {
      continue;
    }

    if (!isRemoteImageUrl(resolved) || deduped.has(resolved)) {
      continue;
    }

    deduped.set(resolved, { original, resolved });
  }

  return Array.from(deduped.values());
}

export function rewriteMarkdownImageUrls(
  content: string,
  articleUrl: string,
  replacements: Map<string, string>
): string {
  return content.replace(ASSET_MARKDOWN_PATTERN, (fullMatch, altText: string, rawUrl: string) => {
    const original = rawUrl?.trim();
    if (!original) {
      return fullMatch;
    }

    let resolved: string;
    try {
      resolved = new URL(original, articleUrl).toString();
    } catch {
      return fullMatch;
    }

    const replacement = replacements.get(resolved);
    if (!replacement) {
      return fullMatch;
    }

    return fullMatch.replace(rawUrl, replacement);
  });
}

async function persistPendingAssets(articleId: string, imageUrls: Array<{ original: string; resolved: string }>): Promise<Asset[]> {
  const existingAssets = await db.assets.where('articleId').equals(articleId).toArray();
  const existingByUrl = new Map(existingAssets.map((asset) => [asset.originalUrl, asset]));
  const now = new Date().toISOString();
  const nextResolvedUrls = new Set(imageUrls.map((entry) => entry.resolved));

  const staleAssets = existingAssets.filter((asset) => !nextResolvedUrls.has(asset.originalUrl));

  if (staleAssets.length > 0) {
    await db.assets.bulkDelete(staleAssets.map((asset) => asset.id));
    await deleteUnreferencedImageUrls(staleAssets.map((asset) => asset.originalUrl));
  }

  const assets: Asset[] = imageUrls.map(({ resolved }) => {
    const existing = existingByUrl.get(resolved);
    return {
      id: existing?.id ?? createId('asset'),
      articleId,
      originalUrl: resolved,
      blob: existing?.blob,
      mimeType: existing?.mimeType,
      status: 'pending',
      attemptCount: 0,
      nextRetryAt: undefined,
      lastError: undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
  });

  if (assets.length > 0) {
    await db.assets.bulkPut(assets);
  }

  return assets;
}

function finalizeCachedAsset(asset: Asset, mimeType?: string): Asset {
  const cachedAsset: Asset = {
    ...asset,
    mimeType: mimeType ?? asset.mimeType,
    status: 'downloaded',
    nextRetryAt: undefined,
    lastError: undefined,
    updatedAt: new Date().toISOString()
  };

  if (!cachedAsset.blob || !isServiceWorkerControllingPage()) {
    return cachedAsset;
  }

  const { blob: _legacyBlob, ...withoutBlob } = cachedAsset;
  return withoutBlob;
}

async function persistCachedAsset(asset: Asset, mimeType?: string): Promise<Asset> {
  const cachedAsset = finalizeCachedAsset(asset, mimeType);
  await db.assets.put(cachedAsset);
  return cachedAsset;
}

async function deleteUnreferencedImageUrls(urls: Iterable<string>): Promise<void> {
  for (const url of new Set(urls)) {
    const referenceCount = await db.assets.filter((asset) => asset.originalUrl === url).count();
    if (referenceCount > 0) {
      continue;
    }

    try {
      await deleteCachedImage(url);
    } catch (error) {
      console.error('[image-cache] failed to delete unreferenced image', { url, error });
    }
  }
}

async function markAssetAttemptFailure(asset: Asset, error: unknown): Promise<Asset> {
  const attemptCount = asset.attemptCount + 1;
  const updatedAt = new Date().toISOString();
  const status: AssetStatus = attemptCount >= MAX_ASSET_RETRY_ATTEMPTS ? 'failed' : 'pending';
  const nextRetryAt = status === 'pending' ? computeNextRetryAt(attemptCount) : undefined;
  const updatedAsset: Asset = {
    ...asset,
    status,
    attemptCount,
    nextRetryAt,
    lastError: toErrorMessage(error),
    updatedAt
  };

  await db.assets.put(updatedAsset);
  return updatedAsset;
}

async function downloadAsset(asset: Asset): Promise<Asset> {
  const startedAt = new Date().toISOString();
  const downloadingAsset: Asset = {
    ...asset,
    status: 'downloading',
    nextRetryAt: undefined,
    updatedAt: startedAt
  };

  await db.assets.put(downloadingAsset);

  try {
    const response = await fetchAndCacheImage(asset.originalUrl);
    const downloadedAsset = finalizeCachedAsset({
      ...downloadingAsset,
      attemptCount: downloadingAsset.attemptCount + 1
    }, response.headers.get('content-type') ?? undefined);

    await db.assets.put(downloadedAsset);
    return downloadedAsset;
  } catch (error) {
    return markAssetAttemptFailure(downloadingAsset, error);
  }
}

async function runAssetRetryQueue(
  assets: Asset[],
  onAssetProgress?: (done: number, total: number) => void
): Promise<Asset[]> {
  const queue = assets.filter((asset) => asset.status !== 'downloaded');
  const results = new Map<string, Asset>(assets.map((asset) => [asset.id, asset]));
  const total = queue.length;
  let done = 0;

  while (queue.length > 0) {
    queue.sort((left, right) => {
      const leftTime = left.nextRetryAt ? new Date(left.nextRetryAt).getTime() : 0;
      const rightTime = right.nextRetryAt ? new Date(right.nextRetryAt).getTime() : 0;
      return leftTime - rightTime;
    });

    const asset = queue.shift();
    if (!asset) {
      continue;
    }

    const dueAt = asset.nextRetryAt ? new Date(asset.nextRetryAt).getTime() : 0;
    const delay = Math.max(0, dueAt - Date.now());
    if (delay > 0) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
    }

    const updated = await downloadAsset(asset);
    results.set(updated.id, updated);

    if (updated.status === 'pending') {
      queue.push(updated);
    } else {
      done++;
      onAssetProgress?.(done, total);
    }
  }

  return Array.from(results.values());
}

async function ensureAssetCached(asset: Asset): Promise<Asset> {
  try {
    const cached = await matchCachedImage(asset.originalUrl);
    if (cached) {
      return persistCachedAsset(asset, cached.headers.get('content-type') ?? undefined);
    }

    if (asset.blob) {
      const migrated = await migrateLegacyBlobToImageCache({
        url: asset.originalUrl,
        blob: asset.blob,
        mimeType: asset.mimeType
      });
      return persistCachedAsset(asset, migrated.headers.get('content-type') ?? undefined);
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Image cache miss while offline; a network retry is required.');
    }

    return downloadAsset(asset);
  } catch (error) {
    console.error('[image-cache] failed to prepare article image', {
      assetId: asset.id,
      articleId: asset.articleId,
      url: asset.originalUrl,
      serviceWorkerControlled: isServiceWorkerControllingPage(),
      error
    });
    return markAssetAttemptFailure(asset, error);
  }
}

export function buildOfflineMarkdown(articleContent: string, articleUrl: string, assets: Asset[]): string {
  const replacements = new Map<string, string>();

  for (const asset of assets) {
    if (asset.status === 'downloaded') {
      replacements.set(asset.originalUrl, createAssetPlaceholder(asset.id));
    }
  }

  return rewriteMarkdownImageUrls(articleContent, articleUrl, replacements);
}

async function downloadArticleAssets(
  article: Article,
  content: string,
  onAssetProgress?: (done: number, total: number) => void
): Promise<string> {
  if (!article.url) {
    return content;
  }

  const imageUrls = extractMarkdownImageUrls(content, article.url);
  if (imageUrls.length === 0) {
    const existingAssets = await db.assets.where('articleId').equals(article.id).toArray();
    if (existingAssets.length > 0) {
      await db.assets.bulkDelete(existingAssets.map((asset) => asset.id));
      await deleteUnreferencedImageUrls(existingAssets.map((asset) => asset.originalUrl));
    }
    return content;
  }

  const pendingAssets = await persistPendingAssets(article.id, imageUrls);
  const finalAssets = await runAssetRetryQueue(pendingAssets, onAssetProgress);
  return buildOfflineMarkdown(content, article.url, finalAssets);
}

export async function hydrateArticleAssets(article: Article): Promise<Article> {
  if (!article.content || !article.content.includes(ASSET_PLACEHOLDER_PREFIX)) {
    return article;
  }

  const assets = await db.assets.where('articleId').equals(article.id).toArray();
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  for (const assetId of new Set(Array.from(article.content.matchAll(ASSET_PLACEHOLDER_PATTERN), (match) => match[1]))) {
    if (!assetId) {
      continue;
    }

    const asset = assetById.get(assetId);
    if (!asset) {
      continue;
    }

    assetById.set(asset.id, await ensureAssetCached(asset));
  }

  const hydratedContent = article.content.replace(
    ASSET_PLACEHOLDER_PATTERN,
    (placeholder, assetId: string) => {
      const asset = assetById.get(assetId);
      if (!asset) {
        return placeholder;
      }
      return asset.originalUrl;
    }
  );

  return {
    ...article,
    content: hydratedContent
  };
}

export async function migrateLegacyAssetsInBackground(batchSize = 8): Promise<void> {
  await deleteObsoleteImageCaches();
  const candidates = await db.assets.filter((asset) => asset.status === 'downloaded' || Boolean(asset.blob)).toArray();

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    for (const asset of batch) {
      await ensureAssetCached(asset);
    }

    if (offset + batchSize < candidates.length) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }

  const allAssets = await db.assets.toArray();
  await reconcileImageCache(new Set(allAssets.map((asset) => asset.originalUrl)));
}

export async function recordArticleImageFailure(articleId: string, imageUrl: string, reason: string): Promise<void> {
  const assets = await db.assets.where('articleId').equals(articleId).toArray();
  const asset = assets.find((entry) => entry.originalUrl === imageUrl);
  if (!asset) {
    return;
  }

  await db.assets.put({
    ...asset,
    lastError: reason,
    updatedAt: new Date().toISOString()
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

async function fetchJson(url: string): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Failed to fetch manifest: ${toErrorMessage(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Manifest request failed with ${response.status} ${response.statusText}.`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Manifest is not valid JSON: ${toErrorMessage(error)}`);
  }
}

export function extractTitleFromMarkdown(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

export function titleFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() ?? '';
    return filename.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim() || 'Imported article';
  } catch {
    return 'Imported article';
  }
}

export async function previewUrlArticle(url: string): Promise<UrlArticlePreview> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Failed to fetch URL: ${toErrorMessage(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}.`);
  }

  const content = await response.text();
  const title = extractTitleFromMarkdown(content) || titleFromUrl(url);
  return { url, title, content };
}

export async function saveUrlArticle(preview: UrlArticlePreview): Promise<string> {
  const groupId = createId('url-group');
  const sourceId = `url:${groupId}`;
  const articleId = `${groupId}:1`;
  const now = new Date().toISOString();

  const article: Article = {
    id: articleId,
    groupId,
    order: 1,
    title: preview.title,
    url: preview.url,
    content: preview.content,
    downloadStatus: 'downloaded',
    createdAt: now,
    updatedAt: now
  };

  const offlineContent = await downloadArticleAssets(article, preview.content);

  await db.transaction('rw', db.sources, db.groups, db.articles, async () => {
    await db.sources.put({
      id: sourceId,
      type: 'url',
      url: preview.url,
      createdAt: now,
      updatedAt: now
    });

    await db.groups.put({
      id: groupId,
      sourceId,
      title: preview.title,
      articleCount: 1,
      offlineStatus: 'downloaded',
      createdAt: now,
      updatedAt: now
    });

    await db.articles.add({
      ...article,
      content: offlineContent
    });
  });

  return groupId;
}

export async function previewManifest(manifestUrl: string): Promise<ManifestPreview> {
  const manifest = validateManifest(await fetchJson(manifestUrl));
  return normalizeManifestPreview(manifestUrl, manifest);
}

export async function saveManifestSource(preview: ManifestPreview): Promise<void> {
  const existingArticles = await db.articles.where('groupId').equals(preview.group.id).toArray();
  const articleMap = new Map(existingArticles.map((article) => [article.id, article]));
  const now = new Date().toISOString();

  const articles = preview.articles.map((article) => {
    const existing = articleMap.get(article.id);
    return {
      ...article,
      content: existing?.content,
      downloadStatus: existing?.downloadStatus ?? article.downloadStatus,
      errorMessage: existing?.errorMessage,
      createdAt: existing?.createdAt ?? article.createdAt,
      updatedAt: now
    };
  });

  await db.transaction('rw', db.sources, db.groups, db.articles, async () => {
    await db.sources.put({
      ...preview.source,
      createdAt: preview.source.createdAt,
      updatedAt: now
    });

    await db.groups.put({
      ...preview.group,
      offlineStatus: calculateGroupOfflineStatus(articles),
      createdAt: preview.group.createdAt,
      updatedAt: now
    });

    await db.articles.bulkPut(articles);
  });
}

export function calculateGroupOfflineStatus(
  articles: Pick<Article, 'downloadStatus'>[]
): 'not_downloaded' | 'partial' | 'downloaded' {
  if (articles.every((article) => article.downloadStatus === 'downloaded')) {
    return 'downloaded';
  }

  if (articles.some((article) => article.downloadStatus === 'downloaded')) {
    return 'partial';
  }

  return 'not_downloaded';
}

export async function loadGroups(): Promise<GroupListItem[]> {
  const groups = await db.groups.orderBy('updatedAt').reverse().toArray();
  const readingStates = await db.readingStates.toArray();
  const articles = await db.articles.toArray();

  const readingStateMap = new Map(readingStates.map((state) => [state.articleId, state]));
  const articleMap = new Map(articles.map((article) => [article.id, article]));

  return groups.map((group) => {
    const lastReadState = group.lastReadArticleId
      ? readingStateMap.get(group.lastReadArticleId)
      : undefined;
    const lastReadArticle = group.lastReadArticleId
      ? articleMap.get(group.lastReadArticleId)
      : undefined;

    return {
      ...group,
      lastReadAt: lastReadState?.lastReadAt,
      lastReadTitle: lastReadArticle?.title
    };
  });
}

export async function loadArticles(groupId: string): Promise<Article[]> {
  const articles = await db.articles.where('groupId').equals(groupId).toArray();
  return articles.sort((left, right) => left.order - right.order);
}

export async function loadReadingState(articleId: string): Promise<ReadingState | undefined> {
  return db.readingStates.get(articleId);
}

export async function saveReadingProgress(input: {
  articleId: string;
  groupId: string;
  scrollPosition: number;
  progressRatio: number;
}): Promise<void> {
  const existing = await db.readingStates.get(input.articleId);
  const now = new Date().toISOString();

  await db.transaction('rw', db.readingStates, db.groups, async () => {
    await db.readingStates.put({
      articleId: input.articleId,
      groupId: input.groupId,
      scrollPosition: Math.max(0, Math.round(input.scrollPosition)),
      progressRatio: Math.max(0, Math.min(1, input.progressRatio)),
      isFavorite: existing?.isFavorite ?? false,
      lastReadAt: now
    });

    await db.groups.update(input.groupId, {
      lastReadArticleId: input.articleId,
      updatedAt: now
    });
  });
}

export async function toggleFavorite(articleId: string, groupId: string, value: boolean): Promise<void> {
  const existing = await db.readingStates.get(articleId);
  const now = new Date().toISOString();

  await db.readingStates.put({
    articleId,
    groupId,
    scrollPosition: existing?.scrollPosition ?? 0,
    progressRatio: existing?.progressRatio ?? 0,
    isFavorite: value,
    lastReadAt: existing?.lastReadAt ?? now
  });
}

export async function downloadGroup(
  groupId: string,
  articleIds?: string[],
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const allArticles = await loadArticles(groupId);
  const targets = articleIds
    ? allArticles.filter((article) => articleIds.includes(article.id))
    : allArticles;

  const articleTotal = targets.length;

  for (let i = 0; i < targets.length; i++) {
    const article = targets[i]!;
    if (!article.url) {
      continue;
    }

    onProgress?.({ articleIndex: i + 1, articleTotal });

    await db.articles.update(article.id, {
      downloadStatus: 'downloading',
      errorMessage: undefined,
      updatedAt: new Date().toISOString()
    });

    try {
      const response = await fetch(article.url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const content = await response.text();
      const offlineContent = await downloadArticleAssets(article, content, (assetIndex, assetTotal) => {
        onProgress?.({ articleIndex: i + 1, articleTotal, assetIndex, assetTotal });
      });
      await db.articles.update(article.id, {
        content: offlineContent,
        downloadStatus: 'downloaded',
        errorMessage: undefined,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      await db.articles.update(article.id, {
        downloadStatus: 'failed',
        errorMessage: toErrorMessage(error),
        updatedAt: new Date().toISOString()
      });
    }
  }

  const refreshedArticles = await loadArticles(groupId);
  await db.groups.update(groupId, {
    offlineStatus: calculateGroupOfflineStatus(refreshedArticles),
    updatedAt: new Date().toISOString()
  });
}

export async function retryFailedArticles(groupId: string): Promise<void> {
  const failedArticles = (await loadArticles(groupId))
    .filter((article) => article.downloadStatus === 'failed')
    .map((article) => article.id);

  await downloadGroup(groupId, failedArticles);
}

export async function openSingleLocalFile(file: File): Promise<TemporaryArticle> {
  return {
    id: createId('temp'),
    groupId: 'temporary',
    order: 1,
    title: file.name.replace(/\.md$/i, ''),
    content: await file.text(),
    fileName: file.name,
    isTemporary: true
  };
}

export async function importLocalFiles(files: File[]): Promise<string> {
  const groupId = createId('local-group');
  const sourceId = `local:${groupId}`;
  const now = new Date().toISOString();
  const articles = await Promise.all(
    files.map(async (file, index) => ({
      id: `${groupId}:${index + 1}`,
      groupId,
      order: index + 1,
      title: file.name.replace(/\.md$/i, ''),
      content: await file.text(),
      downloadStatus: 'downloaded' as const,
      createdAt: now,
      updatedAt: now
    }))
  );

  await db.transaction('rw', db.sources, db.groups, db.articles, async () => {
    await db.sources.put({
      id: sourceId,
      type: 'local',
      createdAt: now,
      updatedAt: now
    });

    await db.groups.put({
      id: groupId,
      sourceId,
      title: files.length === 1 ? articles[0]?.title ?? 'Imported article' : `Imported ${files.length} markdown files`,
      description: files.map((file) => file.name).join(', '),
      articleCount: files.length,
      offlineStatus: 'downloaded',
      createdAt: now,
      updatedAt: now
    });

    await db.articles.bulkAdd(articles);
  });

  return groupId;
}

export async function saveTemporaryArticle(tempArticle: TemporaryArticle): Promise<string> {
  const file = new File([tempArticle.content], tempArticle.fileName, { type: 'text/markdown' });
  return importLocalFiles([file]);
}

export async function removeGroup(groupId: string): Promise<void> {
  const group = await db.groups.get(groupId);
  if (!group) {
    return;
  }

  const articles = await db.articles.where('groupId').equals(groupId).toArray();
  const removedAssets = articles.length > 0
    ? await db.assets.where('articleId').anyOf(articles.map((article) => article.id)).toArray()
    : [];

  await db.transaction('rw', [db.groups, db.articles, db.readingStates, db.sources, db.assets], async () => {
    if (articles.length > 0) {
      await db.assets.where('articleId').anyOf(articles.map((article) => article.id)).delete();
    }
    await db.articles.bulkDelete(articles.map((article) => article.id));

    const readingStates = await db.readingStates.where('groupId').equals(groupId).toArray();
    await db.readingStates.bulkDelete(readingStates.map((state) => state.articleId));

    await db.groups.delete(groupId);

    const remainingGroups = await db.groups.where('sourceId').equals(group.sourceId).count();
    if (remainingGroups === 0) {
      await db.sources.delete(group.sourceId);
    }
  });

  await deleteUnreferencedImageUrls(removedAssets.map((asset) => asset.originalUrl));
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.sources, db.groups, db.articles, db.readingStates, db.assets], async () => {
    await db.assets.clear();
    await db.readingStates.clear();
    await db.articles.clear();
    await db.groups.clear();
    await db.sources.clear();
  });
  await deleteImageCache();
}
