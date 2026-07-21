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
import {
  computeAppliedFingerprint,
  computePreviewFingerprint,
  createManifestUpdatePlan,
  manifestPlanHasChanges,
  sha256Bytes
} from './manifest-update';
import type {
  Article,
  Asset,
  AssetStatus,
  GroupListItem,
  ManifestApplyResult,
  ManifestImportPreview,
  ManifestPreview,
  ManifestUpdatePlan,
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

async function fetchArticleMarkdown(article: Article): Promise<string> {
  if (!article.url) {
    throw new Error('Article has no download URL.');
  }

  const response = await fetch(article.url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();
  if (article.contentHash) {
    const actualHash = await sha256Bytes(bytes);
    if (actualHash !== article.contentHash) {
      throw new Error(`Content hash mismatch: expected ${article.contentHash}, received ${actualHash}.`);
    }
  }

  return new TextDecoder().decode(bytes);
}

async function downloadReplacementArticle(
  articleId: string,
  onAssetProgress?: (done: number, total: number) => void
): Promise<boolean> {
  const article = await db.articles.get(articleId);
  if (!article) {
    return false;
  }

  const stagingArticleId = createId('update-stage');
  let stagedAssets: Asset[] = [];

  try {
    const content = await fetchArticleMarkdown(article);
    const offlineContent = await downloadArticleAssets(
      { ...article, id: stagingArticleId },
      content,
      onAssetProgress
    );
    stagedAssets = await db.assets.where('articleId').equals(stagingArticleId).toArray();
    const failedAsset = stagedAssets.find((asset) => asset.status !== 'downloaded');
    if (failedAsset) {
      throw new Error(failedAsset.lastError ?? `Failed to cache image ${failedAsset.originalUrl}.`);
    }

    const previousAssets = await db.assets.where('articleId').equals(articleId).toArray();
    const now = new Date().toISOString();
    await db.transaction('rw', db.articles, db.assets, async () => {
      if (previousAssets.length > 0) {
        await db.assets.bulkDelete(previousAssets.map((asset) => asset.id));
      }
      if (stagedAssets.length > 0) {
        await db.assets.bulkPut(stagedAssets.map((asset) => ({ ...asset, articleId, updatedAt: now })));
      }
      await db.articles.update(articleId, {
        content: offlineContent,
        downloadedContentHash: article.contentHash,
        downloadStatus: 'downloaded',
        errorMessage: undefined,
        updatedAt: now
      });
    });
    await deleteUnreferencedImageUrls(previousAssets.map((asset) => asset.originalUrl));
    return true;
  } catch (error) {
    if (stagedAssets.length === 0) {
      stagedAssets = await db.assets.where('articleId').equals(stagingArticleId).toArray();
    }
    if (stagedAssets.length > 0) {
      await db.assets.bulkDelete(stagedAssets.map((asset) => asset.id));
      await deleteUnreferencedImageUrls(stagedAssets.map((asset) => asset.originalUrl));
    }
    await db.articles.update(articleId, {
      downloadStatus: 'failed',
      errorMessage: toErrorMessage(error),
      updatedAt: new Date().toISOString()
    });
    return false;
  }
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

export async function previewManifestImport(manifestUrl: string): Promise<ManifestImportPreview> {
  const preview = await previewManifest(manifestUrl);
  const existingGroup = await db.groups.get(preview.group.id);
  if (!existingGroup) {
    return { kind: 'new', preview };
  }

  const source = await db.sources.get(existingGroup.sourceId);
  if (!source || source.type !== 'manifest') {
    throw new Error(`A non-manifest group already uses id "${preview.group.id}".`);
  }

  const articles = await loadArticles(existingGroup.id);
  const plan = await createManifestUpdatePlan({ source, group: existingGroup, articles, target: preview });
  return { kind: 'update', preview, plan };
}

export async function checkManifestUpdate(groupId: string): Promise<ManifestUpdatePlan> {
  const group = await db.groups.get(groupId);
  if (!group) {
    throw new Error('Manifest group no longer exists.');
  }
  const source = await db.sources.get(group.sourceId);
  if (!source || source.type !== 'manifest' || !source.url) {
    throw new Error('This group is not backed by an updateable manifest.');
  }

  const target = await previewManifest(source.url);
  const articles = await loadArticles(groupId);
  const plan = await createManifestUpdatePlan({ source, group, articles, target });
  const now = new Date().toISOString();
  const safeFingerprintBackfill = !source.manifestFingerprint && !manifestPlanHasChanges(plan)
    ? plan.targetFingerprint
    : source.manifestFingerprint;
  await db.sources.update(source.id, {
    lastCheckedAt: now,
    manifestFingerprint: safeFingerprintBackfill,
    updatedAt: now
  });
  return plan;
}

export async function saveManifestSource(preview: ManifestPreview): Promise<void> {
  if (await db.groups.get(preview.group.id)) {
    throw new Error(`A group with id "${preview.group.id}" already exists. Check it for updates instead.`);
  }

  const now = new Date().toISOString();
  const sourceId = createId('manifest-source');
  const fingerprint = await computePreviewFingerprint(preview);
  const articles = preview.articles.map((article) => ({ ...article, updatedAt: now }));

  await db.transaction('rw', db.sources, db.groups, db.articles, async () => {
    await db.sources.add({
      ...preview.source,
      id: sourceId,
      manifestFingerprint: fingerprint,
      createdAt: now,
      updatedAt: now
    });

    await db.groups.add({
      ...preview.group,
      sourceId,
      offlineStatus: calculateGroupOfflineStatus(articles),
      createdAt: now,
      updatedAt: now
    });

    await db.articles.bulkAdd(articles);
  });
}

function resolveLastReadAfterRemoval(
  lastReadArticleId: string | undefined,
  previousArticles: Article[],
  targetArticles: Article[]
): string | undefined {
  if (!lastReadArticleId) {
    return undefined;
  }
  const targetIds = new Set(targetArticles.map((article) => article.id));
  if (targetIds.has(lastReadArticleId)) {
    return lastReadArticleId;
  }

  const orderedPrevious = [...previousArticles].sort((left, right) => left.order - right.order);
  const removedIndex = orderedPrevious.findIndex((article) => article.id === lastReadArticleId);
  if (removedIndex >= 0) {
    for (let index = removedIndex + 1; index < orderedPrevious.length; index++) {
      const candidate = orderedPrevious[index];
      if (candidate && targetIds.has(candidate.id)) {
        return candidate.id;
      }
    }
    for (let index = removedIndex - 1; index >= 0; index--) {
      const candidate = orderedPrevious[index];
      if (candidate && targetIds.has(candidate.id)) {
        return candidate.id;
      }
    }
  }

  return [...targetArticles].sort((left, right) => left.order - right.order)[0]?.id;
}

export async function applyManifestUpdate(
  plan: ManifestUpdatePlan,
  onProgress?: (progress: DownloadProgress) => void
): Promise<ManifestApplyResult> {
  const group = await db.groups.get(plan.groupId);
  const source = group ? await db.sources.get(group.sourceId) : undefined;
  if (!group || !source || source.id !== plan.sourceId || source.type !== 'manifest' || !source.url) {
    throw new Error('The manifest source changed. Check for updates again.');
  }
  if (source.url !== plan.oldManifestUrl) {
    throw new Error('The manifest URL changed. Check for updates again.');
  }

  const existingArticles = await loadArticles(group.id);
  const derivedFingerprint = await computeAppliedFingerprint(
    plan.target.schemaVersion,
    group,
    existingArticles
  );
  const currentFingerprint = source.manifestFingerprint ?? derivedFingerprint;
  if (currentFingerprint !== plan.baseFingerprint) {
    throw new Error('The collection changed after this preview. Check for updates again.');
  }

  const entryByArticleId = new Map(plan.entries.map((entry) => [entry.articleId, entry]));
  const existingById = new Map(existingArticles.map((article) => [article.id, article]));
  const wasFullyDownloaded = group.offlineStatus === 'downloaded'
    && existingArticles.every((article) => article.downloadStatus === 'downloaded');
  const now = new Date().toISOString();
  const downloadArticleIds: string[] = [];
  const nextArticles = plan.target.articles.map((target): Article => {
    const existing = existingById.get(target.id);
    const entry = entryByArticleId.get(target.id);
    if (!existing) {
      if (wasFullyDownloaded) {
        downloadArticleIds.push(target.id);
      }
      return {
        ...target,
        downloadStatus: wasFullyDownloaded ? 'downloading' : 'not_downloaded',
        createdAt: now,
        updatedAt: now
      };
    }

    const shouldDownload = entry?.kind === 'contentChanged'
      && (existing.downloadStatus === 'downloaded' || Boolean(existing.content));
    if (shouldDownload) {
      downloadArticleIds.push(target.id);
    }
    return {
      ...target,
      content: existing.content,
      downloadedContentHash: existing.downloadedContentHash,
      downloadStatus: shouldDownload ? 'downloading' : existing.downloadStatus,
      errorMessage: shouldDownload ? undefined : existing.errorMessage,
      createdAt: existing.createdAt,
      updatedAt: now
    };
  });
  const removedEntries = plan.entries.filter((entry) => entry.kind === 'removed');
  const removedArticleIds = removedEntries.map((entry) => entry.articleId);
  const removedAssets = removedArticleIds.length > 0
    ? await db.assets.where('articleId').anyOf(removedArticleIds).toArray()
    : [];
  const selectedArticleId = resolveLastReadAfterRemoval(
    group.lastReadArticleId,
    existingArticles,
    nextArticles
  );

  await db.transaction(
    'rw',
    [db.sources, db.groups, db.articles, db.readingStates, db.assets],
    async () => {
      if (removedArticleIds.length > 0) {
        await db.assets.where('articleId').anyOf(removedArticleIds).delete();
        await db.readingStates.where('articleId').anyOf(removedArticleIds).delete();
        await db.articles.bulkDelete(removedArticleIds);
      }
      await db.articles.bulkPut(nextArticles);
      await db.sources.update(source.id, {
        url: plan.newManifestUrl,
        manifestFingerprint: plan.targetFingerprint,
        lastCheckedAt: now,
        updatedAt: now
      });
      await db.groups.put({
        ...plan.target.group,
        sourceId: source.id,
        offlineStatus: calculateGroupOfflineStatus(nextArticles),
        lastReadArticleId: selectedArticleId,
        createdAt: group.createdAt,
        updatedAt: now
      });
    }
  );

  await deleteUnreferencedImageUrls(removedAssets.map((asset) => asset.originalUrl));

  const downloadedArticleIds: string[] = [];
  const failedArticleIds: string[] = [];
  for (let index = 0; index < downloadArticleIds.length; index++) {
    const articleId = downloadArticleIds[index]!;
    onProgress?.({ articleIndex: index + 1, articleTotal: downloadArticleIds.length });
    const succeeded = await downloadReplacementArticle(articleId, (assetIndex, assetTotal) => {
      onProgress?.({
        articleIndex: index + 1,
        articleTotal: downloadArticleIds.length,
        assetIndex,
        assetTotal
      });
    });
    (succeeded ? downloadedArticleIds : failedArticleIds).push(articleId);
  }

  const refreshedArticles = await loadArticles(group.id);
  await db.groups.update(group.id, {
    offlineStatus: calculateGroupOfflineStatus(refreshedArticles),
    updatedAt: new Date().toISOString()
  });

  return {
    groupId: group.id,
    downloadedArticleIds,
    failedArticleIds,
    removedArticleIds,
    selectedArticleId
  };
}

export function calculateGroupOfflineStatus(
  articles: Array<Pick<Article, 'downloadStatus'> & Partial<Pick<Article, 'content' | 'contentHash' | 'downloadedContentHash'>>>
): 'not_downloaded' | 'partial' | 'downloaded' {
  const isCurrentDownload = (article: typeof articles[number]) =>
    article.downloadStatus === 'downloaded'
    && (!article.contentHash || article.downloadedContentHash === article.contentHash);

  if (articles.every(isCurrentDownload)) {
    return 'downloaded';
  }

  if (articles.some((article) => article.downloadStatus === 'downloaded' || Boolean(article.content))) {
    return 'partial';
  }

  return 'not_downloaded';
}

export async function loadGroups(): Promise<GroupListItem[]> {
  const groups = await db.groups.orderBy('updatedAt').reverse().toArray();
  const sources = await db.sources.toArray();
  const readingStates = await db.readingStates.toArray();
  const articles = await db.articles.toArray();

  const readingStateMap = new Map(readingStates.map((state) => [state.articleId, state]));
  const articleMap = new Map(articles.map((article) => [article.id, article]));
  const sourceMap = new Map(sources.map((source) => [source.id, source]));

  return groups.map((group) => {
    const lastReadState = group.lastReadArticleId
      ? readingStateMap.get(group.lastReadArticleId)
      : undefined;
    const lastReadArticle = group.lastReadArticleId
      ? articleMap.get(group.lastReadArticleId)
      : undefined;
    const source = sourceMap.get(group.sourceId);

    return {
      ...group,
      lastReadAt: lastReadState?.lastReadAt,
      lastReadTitle: lastReadArticle?.title,
      sourceType: source?.type,
      sourceUrl: source?.url,
      sourceLastCheckedAt: source?.lastCheckedAt
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
    await downloadReplacementArticle(article.id, (assetIndex, assetTotal) => {
      onProgress?.({ articleIndex: i + 1, articleTotal, assetIndex, assetTotal });
    });
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

export async function recoverInterruptedDownloads(): Promise<number> {
  const interrupted = await db.articles.where('downloadStatus').equals('downloading').toArray();
  if (interrupted.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();
  const groupIds = new Set(interrupted.map((article) => article.groupId));
  await db.articles.bulkPut(interrupted.map((article) => ({
    ...article,
    downloadStatus: 'failed' as const,
    errorMessage: 'Download was interrupted. Retry to continue.',
    updatedAt: now
  })));
  for (const groupId of groupIds) {
    const articles = await loadArticles(groupId);
    await db.groups.update(groupId, {
      offlineStatus: calculateGroupOfflineStatus(articles),
      updatedAt: now
    });
  }
  return interrupted.length;
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
