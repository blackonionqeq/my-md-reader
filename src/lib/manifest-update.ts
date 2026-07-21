import type {
  Article,
  Group,
  ManifestPreview,
  ManifestUpdateEntry,
  ManifestUpdatePlan,
  Source
} from './types';

type AppliedManifest = {
  schemaVersion: number;
  group: Group;
  articles: Article[];
};

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export async function sha256Bytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const source = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  const ownedBytes = new Uint8Array(source.byteLength);
  ownedBytes.set(source);
  const digest = await crypto.subtle.digest('SHA-256', ownedBytes as BufferSource);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

function canonicalArticles(articles: Article[]): Array<Record<string, string | number | null>> {
  return articles
    .map((article) => ({
      id: articleManifestId(article),
      title: article.title,
      url: article.url ?? null,
      order: article.order,
      contentHash: article.contentHash ?? null
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

async function fingerprint(input: AppliedManifest): Promise<string> {
  const canonical = {
    schemaVersion: input.schemaVersion,
    id: input.group.id,
    title: input.group.title,
    description: input.group.description ?? null,
    version: input.group.version ?? null,
    articles: canonicalArticles(input.articles)
  };

  return sha256Bytes(utf8(JSON.stringify(canonical)));
}

export function articleManifestId(article: Pick<Article, 'id' | 'groupId'>): string {
  const prefix = `${article.groupId}:`;
  return article.id.startsWith(prefix) ? article.id.slice(prefix.length) : article.id;
}

export async function computePreviewFingerprint(preview: ManifestPreview): Promise<string> {
  return fingerprint({
    schemaVersion: preview.schemaVersion,
    group: preview.group,
    articles: preview.articles
  });
}

export async function computeAppliedFingerprint(
  schemaVersion: number,
  group: Group,
  articles: Article[]
): Promise<string> {
  return fingerprint({ schemaVersion, group, articles });
}

function hasLocalContent(article: Article): boolean {
  return article.downloadStatus === 'downloaded' || Boolean(article.content);
}

function classifyRetainedArticle(
  existing: Article,
  target: Article,
  versionChanged: boolean
): ManifestUpdateEntry['kind'] {
  if (existing.url !== target.url) {
    return 'contentChanged';
  }

  const existingHash = existing.contentHash;
  const targetHash = target.contentHash;
  if (existingHash && targetHash && existingHash !== targetHash) {
    return 'contentChanged';
  }

  if (hasLocalContent(existing) && Boolean(existingHash) !== Boolean(targetHash)) {
    return 'contentChanged';
  }

  if (hasLocalContent(existing) && !existingHash && !targetHash && versionChanged) {
    return 'contentChanged';
  }

  if (existing.title !== target.title || existing.order !== target.order) {
    return 'metadataChanged';
  }

  return 'unchanged';
}

export async function createManifestUpdatePlan(input: {
  source: Source;
  group: Group;
  articles: Article[];
  target: ManifestPreview;
}): Promise<ManifestUpdatePlan> {
  if (!input.source.url) {
    throw new Error('Manifest source has no update URL.');
  }
  if (input.group.id !== input.target.group.id) {
    throw new Error(`Manifest id changed from "${input.group.id}" to "${input.target.group.id}".`);
  }

  const derivedBaseFingerprint = await computeAppliedFingerprint(
    input.target.schemaVersion,
    input.group,
    input.articles
  );
  const baseFingerprint = input.source.manifestFingerprint ?? derivedBaseFingerprint;
  const targetFingerprint = await computePreviewFingerprint(input.target);
  const existingByManifestId = new Map(
    input.articles.map((article) => [articleManifestId(article), article])
  );
  const targetByManifestId = new Map(
    input.target.articles.map((article) => [articleManifestId(article), article])
  );
  const versionChanged = input.group.version !== input.target.group.version;
  const entries: ManifestUpdateEntry[] = [];

  for (const target of input.target.articles) {
    const manifestId = articleManifestId(target);
    const existing = existingByManifestId.get(manifestId);
    const kind = existing
      ? classifyRetainedArticle(existing, target, versionChanged)
      : 'added';
    entries.push({
      kind,
      articleId: target.id,
      title: target.title,
      previousTitle: existing?.title,
      wasDownloaded: existing ? hasLocalContent(existing) : false
    });
  }

  for (const existing of input.articles) {
    if (targetByManifestId.has(articleManifestId(existing))) {
      continue;
    }
    entries.push({
      kind: 'removed',
      articleId: existing.id,
      title: existing.title,
      wasDownloaded: hasLocalContent(existing)
    });
  }

  return {
    groupId: input.group.id,
    sourceId: input.source.id,
    baseFingerprint,
    targetFingerprint,
    oldManifestUrl: input.source.url,
    newManifestUrl: input.target.manifestUrl,
    oldVersion: input.group.version,
    newVersion: input.target.group.version,
    sourceUrlChanged: input.source.url !== input.target.manifestUrl,
    groupMetadataChanged:
      input.group.title !== input.target.group.title
      || input.group.description !== input.target.group.description
      || versionChanged,
    legacyPrecision: input.target.articles.some((article) => !article.contentHash),
    target: input.target,
    entries
  };
}

export function manifestPlanHasChanges(plan: ManifestUpdatePlan): boolean {
  return plan.sourceUrlChanged
    || plan.groupMetadataChanged
    || plan.entries.some((entry) => entry.kind !== 'unchanged');
}
