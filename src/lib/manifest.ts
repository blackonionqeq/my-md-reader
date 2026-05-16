import type { Article, Group, ManifestFile, ManifestPreview, Source } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Manifest field "${field}" must be a non-empty string.`);
  }

  return value.trim();
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`Manifest field "${field}" must be a string when present.`);
  }

  return value.trim();
}

export function validateManifest(input: unknown): ManifestFile {
  if (!isRecord(input)) {
    throw new Error('Manifest must be a JSON object.');
  }

  const schemaVersion = input.schemaVersion;
  if (typeof schemaVersion !== 'number') {
    throw new Error('Manifest field "schemaVersion" must be a number.');
  }

  const id = readRequiredString(input.id, 'id');
  const title = readRequiredString(input.title, 'title');
  const description = readOptionalString(input.description, 'description');
  const version = readOptionalString(input.version, 'version');

  if (!Array.isArray(input.articles) || input.articles.length === 0) {
    throw new Error('Manifest field "articles" must be a non-empty array.');
  }

  const articles = input.articles.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Manifest article at index ${index} must be an object.`);
    }

    const id = readRequiredString(entry.id, `articles[${index}].id`);
    const title = readRequiredString(entry.title, `articles[${index}].title`);
    const url = readRequiredString(entry.url, `articles[${index}].url`);
    const order = entry.order;

    if (order !== undefined && (typeof order !== 'number' || Number.isNaN(order))) {
      throw new Error(`Manifest article field "articles[${index}].order" must be a number when present.`);
    }

    return {
      id,
      title,
      url,
      order
    };
  });

  return {
    schemaVersion,
    id,
    title,
    description,
    version,
    articles
  };
}

export function resolveManifestArticleUrl(manifestUrl: string, articleUrl: string): string {
  return new URL(articleUrl, manifestUrl).toString();
}

export function normalizeManifestPreview(manifestUrl: string, manifest: ManifestFile): ManifestPreview {
  const now = new Date().toISOString();
  const source: Source = {
    id: `manifest:${manifestUrl}`,
    type: 'manifest',
    url: manifestUrl,
    createdAt: now,
    updatedAt: now
  };

  const group: Group = {
    id: manifest.id,
    sourceId: source.id,
    title: manifest.title,
    description: manifest.description,
    version: manifest.version,
    articleCount: manifest.articles.length,
    offlineStatus: 'not_downloaded',
    createdAt: now,
    updatedAt: now
  };

  const articles: Article[] = manifest.articles.map((entry, index) => ({
    id: `${manifest.id}:${entry.id}`,
    groupId: manifest.id,
    order: entry.order ?? index + 1,
    title: entry.title,
    url: resolveManifestArticleUrl(manifestUrl, entry.url),
    downloadStatus: 'not_downloaded',
    createdAt: now,
    updatedAt: now
  }));

  return {
    manifestUrl,
    source,
    group,
    articles
  };
}
