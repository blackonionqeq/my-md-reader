import { db } from './db';
import { createId } from './id';
import { normalizeManifestPreview, validateManifest } from './manifest';
import type {
  Article,
  GroupListItem,
  ManifestPreview,
  ReadingState,
  TemporaryArticle
} from './types';

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

export async function downloadGroup(groupId: string, articleIds?: string[]): Promise<void> {
  const allArticles = await loadArticles(groupId);
  const targets = articleIds
    ? allArticles.filter((article) => articleIds.includes(article.id))
    : allArticles;

  for (const article of targets) {
    if (!article.url) {
      continue;
    }

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
      await db.articles.update(article.id, {
        content,
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

  await db.transaction('rw', db.groups, db.articles, db.readingStates, db.sources, async () => {
    const articles = await db.articles.where('groupId').equals(groupId).toArray();
    await db.articles.bulkDelete(articles.map((article) => article.id));

    const readingStates = await db.readingStates.where('groupId').equals(groupId).toArray();
    await db.readingStates.bulkDelete(readingStates.map((state) => state.articleId));

    await db.groups.delete(groupId);

    const remainingGroups = await db.groups.where('sourceId').equals(group.sourceId).count();
    if (remainingGroups === 0) {
      await db.sources.delete(group.sourceId);
    }
  });
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.sources, db.groups, db.articles, db.readingStates, db.assets], async () => {
    await db.assets.clear();
    await db.readingStates.clear();
    await db.articles.clear();
    await db.groups.clear();
    await db.sources.clear();
  });
}
