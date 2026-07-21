import { describe, expect, it } from 'vitest';
import { normalizeManifestPreview, validateManifest } from './manifest';
import {
  computePreviewFingerprint,
  createManifestUpdatePlan,
  manifestPlanHasChanges,
  sha256Bytes
} from './manifest-update';
import type { Article, Group, Source } from './types';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const NOW = '2026-07-21T00:00:00.000Z';

function stored(input: {
  version?: string;
  articles?: Partial<Article>[];
} = {}): { source: Source; group: Group; articles: Article[] } {
  const source: Source = {
    id: 'source:1',
    type: 'manifest',
    url: 'https://reader.test/manifest.json',
    createdAt: NOW,
    updatedAt: NOW
  };
  const group: Group = {
    id: 'course',
    sourceId: source.id,
    title: 'Course',
    version: input.version,
    articleCount: input.articles?.length ?? 1,
    offlineStatus: 'downloaded',
    createdAt: NOW,
    updatedAt: NOW
  };
  const articles = (input.articles ?? [{}]).map((article, index): Article => ({
    id: article.id ?? `course:a${index + 1}`,
    groupId: 'course',
    order: article.order ?? index + 1,
    title: article.title ?? `Article ${index + 1}`,
    url: article.url ?? `https://reader.test/a${index + 1}.md`,
    contentHash: article.contentHash,
    downloadedContentHash: article.downloadedContentHash,
    content: article.content ?? '# Cached',
    downloadStatus: article.downloadStatus ?? 'downloaded',
    createdAt: NOW,
    updatedAt: NOW
  }));
  return { source, group, articles };
}

function target(input: {
  url?: string;
  version?: string;
  title?: string;
  articles?: Array<{ id: string; title?: string; url?: string; order?: number; contentHash?: string }>;
} = {}) {
  return normalizeManifestPreview(input.url ?? 'https://reader.test/manifest.json', {
    schemaVersion: 1,
    id: 'course',
    title: input.title ?? 'Course',
    version: input.version,
    articles: (input.articles ?? [{ id: 'a1' }]).map((article, index) => ({
      id: article.id,
      title: article.title ?? `Article ${index + 1}`,
      url: article.url ?? `a${index + 1}.md`,
      order: article.order,
      contentHash: article.contentHash
    }))
  });
}

describe('manifest content hashes', () => {
  it('normalizes uppercase sha256 hashes and rejects malformed values', () => {
    const manifest = validateManifest({
      schemaVersion: 1,
      id: 'course',
      title: 'Course',
      articles: [{ id: 'a1', title: 'One', url: '1.md', contentHash: HASH_A.toUpperCase() }]
    });
    expect(manifest.articles[0]?.contentHash).toBe(HASH_A);

    expect(() => validateManifest({
      schemaVersion: 1,
      id: 'course',
      title: 'Course',
      articles: [{ id: 'a1', title: 'One', url: '1.md', contentHash: 'sha256:nope' }]
    })).toThrow(/64 hexadecimal/);
  });

  it('rejects duplicate article ids', () => {
    expect(() => validateManifest({
      schemaVersion: 1,
      id: 'course',
      title: 'Course',
      articles: [
        { id: 'a1', title: 'One', url: '1.md' },
        { id: 'a1', title: 'Again', url: '2.md' }
      ]
    })).toThrow(/must be unique/);
  });

  it('hashes exact bytes', async () => {
    await expect(sha256Bytes(new TextEncoder().encode('abc'))).resolves.toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});

describe('manifest fingerprints', () => {
  it('is stable for equivalent normalized manifests', async () => {
    const first = target({
      articles: [
        { id: 'b', title: 'B', url: 'b.md', order: 2, contentHash: HASH_B },
        { id: 'a', title: 'A', url: 'a.md', order: 1, contentHash: HASH_A }
      ]
    });
    const second = target({
      articles: [
        { id: 'a', title: 'A', url: 'a.md', order: 1, contentHash: HASH_A },
        { id: 'b', title: 'B', url: 'b.md', order: 2, contentHash: HASH_B }
      ]
    });

    await expect(computePreviewFingerprint(first)).resolves.toBe(await computePreviewFingerprint(second));
  });

  it('changes when effective article order changes', async () => {
    const first = target({ articles: [{ id: 'a' }, { id: 'b' }] });
    const second = target({ articles: [{ id: 'b' }, { id: 'a' }] });
    expect(await computePreviewFingerprint(first)).not.toBe(await computePreviewFingerprint(second));
  });
});

describe('createManifestUpdatePlan', () => {
  it('classifies additions, removals, content changes, and metadata changes', async () => {
    const current = stored({
      version: '1',
      articles: [
        { id: 'course:keep', title: 'Keep', url: 'https://reader.test/keep.md', contentHash: HASH_A },
        { id: 'course:changed', title: 'Changed', url: 'https://reader.test/changed.md', contentHash: HASH_A },
        { id: 'course:meta', title: 'Old title', url: 'https://reader.test/meta.md', contentHash: HASH_A },
        { id: 'course:removed', title: 'Removed', url: 'https://reader.test/removed.md', contentHash: HASH_A }
      ]
    });
    const next = target({
      version: '2',
      articles: [
        { id: 'keep', title: 'Keep', url: 'keep.md', contentHash: HASH_A },
        { id: 'changed', title: 'Changed', url: 'changed.md', contentHash: HASH_B },
        { id: 'meta', title: 'New title', url: 'meta.md', contentHash: HASH_A },
        { id: 'added', title: 'Added', url: 'added.md', contentHash: HASH_A }
      ]
    });

    const plan = await createManifestUpdatePlan({ ...current, target: next });
    expect(Object.fromEntries(plan.entries.map((entry) => [entry.articleId, entry.kind]))).toEqual({
      'course:keep': 'unchanged',
      'course:changed': 'contentChanged',
      'course:meta': 'metadataChanged',
      'course:added': 'added',
      'course:removed': 'removed'
    });
    expect(manifestPlanHasChanges(plan)).toBe(true);
  });

  it('treats a URL change as content changed even when the hash matches', async () => {
    const current = stored({ articles: [{ contentHash: HASH_A }] });
    const next = target({ articles: [{ id: 'a1', url: 'moved/a1.md', contentHash: HASH_A }] });
    const plan = await createManifestUpdatePlan({ ...current, target: next });
    expect(plan.entries[0]?.kind).toBe('contentChanged');
  });

  it('uses manifest version as a conservative fallback for downloaded hashless articles', async () => {
    const current = stored({ version: '1' });
    const changed = await createManifestUpdatePlan({ ...current, target: target({ version: '2' }) });
    const unchanged = await createManifestUpdatePlan({ ...current, target: target({ version: '1' }) });
    expect(changed.entries[0]?.kind).toBe('contentChanged');
    expect(unchanged.entries[0]?.kind).toBe('unchanged');
    expect(changed.legacyPrecision).toBe(true);
  });

  it('detects source relocation separately from content changes', async () => {
    const current = stored({ articles: [{ contentHash: HASH_A }] });
    const next = target({
      url: 'https://moved.test/manifest.json',
      articles: [{ id: 'a1', url: 'https://reader.test/a1.md', contentHash: HASH_A }]
    });
    const plan = await createManifestUpdatePlan({ ...current, target: next });
    expect(plan.sourceUrlChanged).toBe(true);
    expect(plan.entries[0]?.kind).toBe('unchanged');
    expect(manifestPlanHasChanges(plan)).toBe(true);
  });
});
