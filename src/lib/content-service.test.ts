import { readFile } from 'node:fs/promises';
import path from 'node:path';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildOfflineMarkdown,
  clearAllData,
  calculateGroupOfflineStatus,
  computeNextRetryAt,
  extractMarkdownImageUrls,
  importLocalFiles,
  loadArticles,
  loadGroups,
  openSingleLocalFile,
  removeGroup,
  saveTemporaryArticle,
  rewriteMarkdownImageUrls
} from './content-service';
import { db } from './db';
import type { Asset } from './types';

describe('calculateGroupOfflineStatus', () => {
  it('returns downloaded when every article is downloaded', () => {
    expect(calculateGroupOfflineStatus([
      { downloadStatus: 'downloaded' },
      { downloadStatus: 'downloaded' }
    ])).toBe('downloaded');
  });

  it('returns partial when at least one article is downloaded', () => {
    expect(calculateGroupOfflineStatus([
      { downloadStatus: 'downloaded' },
      { downloadStatus: 'failed' }
    ])).toBe('partial');
  });

  it('returns not_downloaded when nothing is downloaded', () => {
    expect(calculateGroupOfflineStatus([
      { downloadStatus: 'failed' },
      { downloadStatus: 'not_downloaded' }
    ])).toBe('not_downloaded');
  });
});

beforeEach(async () => {
  class TestFile {
    name: string;
    type: string;
    #content: string;

    constructor(parts: BlobPart[], name: string, options?: BlobPropertyBag) {
      this.name = name;
      this.type = options?.type ?? '';
      this.#content = parts.join('');
    }

    async text(): Promise<string> {
      return this.#content;
    }
  }

  globalThis.File = TestFile as unknown as typeof File;

  if (!db.isOpen()) {
    db.open();
  }

  await clearAllData();
});

afterEach(async () => {
  await clearAllData();
});

describe('extractMarkdownImageUrls', () => {
  it('resolves relative and absolute image urls and skips duplicates', () => {
    const content = [
      '![cover](./images/cover.png)',
      '![dup](./images/cover.png)',
      '![remote](https://cdn.reader.test/banner.jpg)',
      '![ignored](mailto:test@example.com)'
    ].join('\n');

    expect(extractMarkdownImageUrls(content, 'https://reader.test/articles/intro.md')).toEqual([
      {
        original: './images/cover.png',
        resolved: 'https://reader.test/articles/images/cover.png'
      },
      {
        original: 'https://cdn.reader.test/banner.jpg',
        resolved: 'https://cdn.reader.test/banner.jpg'
      }
    ]);
  });
});

describe('rewriteMarkdownImageUrls', () => {
  it('rewrites only matching markdown image urls', () => {
    const content = '![cover](./images/cover.png)\n![keep](https://reader.test/keep.png)';
    const replacements = new Map<string, string>([
      ['https://reader.test/articles/images/cover.png', 'mdr-asset://asset:123']
    ]);

    expect(
      rewriteMarkdownImageUrls(content, 'https://reader.test/articles/intro.md', replacements)
    ).toBe('![cover](mdr-asset://asset:123)\n![keep](https://reader.test/keep.png)');
  });
});

describe('computeNextRetryAt', () => {
  it('uses increasing retry delays and stops after the fifth attempt', () => {
    const baseTime = Date.UTC(2026, 4, 17, 0, 0, 0);

    expect(computeNextRetryAt(1, baseTime)).toBe(new Date(baseTime + 1000).toISOString());
    expect(computeNextRetryAt(2, baseTime)).toBe(new Date(baseTime + 3000).toISOString());
    expect(computeNextRetryAt(3, baseTime)).toBe(new Date(baseTime + 10000).toISOString());
    expect(computeNextRetryAt(4, baseTime)).toBe(new Date(baseTime + 30000).toISOString());
    expect(computeNextRetryAt(5, baseTime)).toBeUndefined();
  });
});

describe('buildOfflineMarkdown', () => {
  it('replaces only successfully downloaded images with stable asset placeholders', () => {
    const content = [
      '![ok](./images/ok.png)',
      '![failed](./images/failed.png)'
    ].join('\n');

    const assets: Asset[] = [
      {
        id: 'asset:ok',
        articleId: 'article:1',
        originalUrl: 'https://reader.test/articles/images/ok.png',
        status: 'downloaded',
        attemptCount: 1,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z'
      },
      {
        id: 'asset:failed',
        articleId: 'article:1',
        originalUrl: 'https://reader.test/articles/images/failed.png',
        status: 'failed',
        attemptCount: 5,
        lastError: '404 Not Found',
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z'
      }
    ];

    expect(buildOfflineMarkdown(content, 'https://reader.test/articles/intro.md', assets)).toBe([
      '![ok](mdr-asset://asset:ok)',
      '![failed](./images/failed.png)'
    ].join('\n'));
  });
});

describe('openSingleLocalFile', () => {
  it('opens a real markdown file fixture as a temporary article', async () => {
    const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/sample-article-with-image.md');
    const content = await readFile(fixturePath, 'utf8');
    const file = new File([content], 'sample-article-with-image.md', { type: 'text/markdown' });

    const article = await openSingleLocalFile(file);

    expect(article.isTemporary).toBe(true);
    expect(article.groupId).toBe('temporary');
    expect(article.order).toBe(1);
    expect(article.fileName).toBe('sample-article-with-image.md');
    expect(article.title).toBe('sample-article-with-image');
    expect(article.content).toContain('# Sample Article With Image');
    expect(article.content).toContain('![Fixture image](./sample-reader-image.png)');
  });
});

describe('removeGroup', () => {
  it('removes an imported local markdown group and its stored articles', async () => {
    const groupId = await importLocalFiles([
      new File(['# One'], 'one.md', { type: 'text/markdown' })
    ]);

    expect(await loadArticles(groupId)).toHaveLength(1);
    expect(await loadGroups()).toHaveLength(1);

    await removeGroup(groupId);

    expect(await loadArticles(groupId)).toHaveLength(0);
    expect(await loadGroups()).toHaveLength(0);
    expect(await db.sources.toArray()).toHaveLength(0);
    expect(await db.groups.toArray()).toHaveLength(0);
    expect(await db.articles.toArray()).toHaveLength(0);
  });
});

describe('clearAllData', () => {
  it('clears temporary-saved markdown imports and related cached state', async () => {
    const savedGroupId = await saveTemporaryArticle({
      id: 'temp:article-1',
      groupId: 'temporary',
      order: 1,
      title: 'Fixture Article',
      content: '# Fixture Article\n\n![Fixture image](./sample-reader-image.png)',
      fileName: 'fixture-article.md',
      isTemporary: true
    });

    await db.assets.put({
      id: 'asset:test-1',
      articleId: `${savedGroupId}:1`,
      originalUrl: 'https://reader.test/image.png',
      status: 'downloaded',
      attemptCount: 1,
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z'
    });

    expect(await loadGroups()).toHaveLength(1);
    expect(await loadArticles(savedGroupId)).toHaveLength(1);
    expect(await db.assets.toArray()).toHaveLength(1);

    await clearAllData();

    expect(await loadGroups()).toHaveLength(0);
    expect(await db.sources.toArray()).toHaveLength(0);
    expect(await db.groups.toArray()).toHaveLength(0);
    expect(await db.articles.toArray()).toHaveLength(0);
    expect(await db.readingStates.toArray()).toHaveLength(0);
    expect(await db.assets.toArray()).toHaveLength(0);
  });
});
