import { readFile } from 'node:fs/promises';
import { Blob as NodeBlob } from 'node:buffer';
import path from 'node:path';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOfflineMarkdown,
  clearAllData,
  calculateGroupOfflineStatus,
  computeNextRetryAt,
  extractMarkdownImageUrls,
  extractTitleFromMarkdown,
  hydrateArticleAssets,
  importLocalFiles,
  loadArticles,
  loadGroups,
  openSingleLocalFile,
  previewUrlArticle,
  removeGroup,
  rewriteMarkdownImageUrls,
  saveTemporaryArticle,
  saveUrlArticle,
  titleFromUrl
} from './content-service';
import { db } from './db';
import type { Asset } from './types';

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}

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
  Object.defineProperties(URL, {
    createObjectURL: {
      configurable: true,
      value: vi.fn(() => 'blob:https://reader.test/cached-image')
    },
    revokeObjectURL: {
      configurable: true,
      value: vi.fn()
    }
  });

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

describe('hydrateArticleAssets', () => {
  it('rebuilds a persisted blob with the stored image MIME type', async () => {
    const persistedBlob = new NodeBlob(['cached-image'], { type: 'application/octet-stream' }) as Blob;
    await db.assets.put({
      id: 'asset:cached',
      articleId: 'article:1',
      originalUrl: 'https://reader.test/images/cached.bin',
      blob: persistedBlob,
      mimeType: 'image/png; charset=binary',
      status: 'downloaded',
      attemptCount: 1,
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z'
    });

    const article = await hydrateArticleAssets({
      id: 'article:1',
      groupId: 'group:1',
      order: 1,
      title: 'Cached image',
      content: '![cached](mdr-asset://asset:cached)',
      downloadStatus: 'downloaded',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z'
    });

    expect(article.content).toBe('![cached](blob:https://reader.test/cached-image)');
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    const rebuiltBlob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(rebuiltBlob).not.toBe(persistedBlob);
    expect(rebuiltBlob.type).toBe('image/png');
    expect(await readBlobAsText(rebuiltBlob)).toBe('cached-image');
  });

  it('infers the image MIME type from the original URL when stored types are invalid', async () => {
    await db.assets.put({
      id: 'asset:cover',
      articleId: 'article:2',
      originalUrl: 'https://reader.test/images/cover.webp?version=2',
      blob: new NodeBlob(['webp-image']) as Blob,
      mimeType: 'text/plain',
      status: 'downloaded',
      attemptCount: 1,
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z'
    });

    const article = await hydrateArticleAssets({
      id: 'article:2',
      groupId: 'group:1',
      order: 2,
      title: 'Cover',
      content: '![cover](mdr-asset://asset:cover)',
      downloadStatus: 'downloaded',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z'
    });

    expect(article.content).toBe('![cover](blob:https://reader.test/cached-image)');
    const rebuiltBlob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(rebuiltBlob.type).toBe('image/webp');
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

describe('extractTitleFromMarkdown', () => {
  it('returns the first h1 heading text', () => {
    expect(extractTitleFromMarkdown('# Hello World\n\nBody text.')).toBe('Hello World');
  });

  it('returns undefined when there is no heading', () => {
    expect(extractTitleFromMarkdown('Just some plain text.')).toBeUndefined();
  });

  it('ignores h2 and deeper headings', () => {
    expect(extractTitleFromMarkdown('## Sub Heading\n\nBody')).toBeUndefined();
  });

  it('picks the first heading when content has multiple', () => {
    expect(extractTitleFromMarkdown('# First\n\n# Second')).toBe('First');
  });

  it('trims whitespace around the heading text', () => {
    expect(extractTitleFromMarkdown('#   Padded Title   ')).toBe('Padded Title');
  });
});

describe('titleFromUrl', () => {
  it('extracts and humanizes a filename from the URL path', () => {
    expect(titleFromUrl('https://example.com/my-great-article.md')).toBe('my great article');
  });

  it('strips the .md extension', () => {
    expect(titleFromUrl('https://example.com/notes.md')).toBe('notes');
  });

  it('replaces underscores with spaces', () => {
    expect(titleFromUrl('https://example.com/my_notes.md')).toBe('my notes');
  });

  it('returns fallback for URLs without a usable filename', () => {
    expect(titleFromUrl('https://example.com/')).toBe('Imported article');
  });

  it('returns fallback for invalid URLs', () => {
    expect(titleFromUrl('not-a-url')).toBe('Imported article');
  });
});

describe('previewUrlArticle', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns preview with title extracted from markdown heading', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# My Article\n\nSome content here.')
    });

    const preview = await previewUrlArticle('https://example.com/article.md');

    expect(preview.title).toBe('My Article');
    expect(preview.url).toBe('https://example.com/article.md');
    expect(preview.content).toBe('# My Article\n\nSome content here.');
  });

  it('falls back to filename from URL when no heading found', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('Just some text without a heading.')
    });

    const preview = await previewUrlArticle('https://example.com/my-notes.md');

    expect(preview.title).toBe('my notes');
  });

  it('throws on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(previewUrlArticle('https://example.com/fail.md'))
      .rejects.toThrow('Failed to fetch URL');
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });

    await expect(previewUrlArticle('https://example.com/missing.md'))
      .rejects.toThrow('404 Not Found');
  });
});

describe('saveUrlArticle', () => {
  it('persists a url article as a single-article group', async () => {
    const preview = {
      url: 'https://example.com/article.md',
      title: 'Test Article',
      content: '# Test Article\n\nBody text.'
    };

    const groupId = await saveUrlArticle(preview);

    const groups = await loadGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('Test Article');
    expect(groups[0]!.articleCount).toBe(1);
    expect(groups[0]!.offlineStatus).toBe('downloaded');

    const articles = await loadArticles(groupId);
    expect(articles).toHaveLength(1);
    expect(articles[0]!.title).toBe('Test Article');
    expect(articles[0]!.url).toBe('https://example.com/article.md');
    expect(articles[0]!.content).toBe('# Test Article\n\nBody text.');
    expect(articles[0]!.downloadStatus).toBe('downloaded');

    const sources = await db.sources.toArray();
    expect(sources).toHaveLength(1);
    expect(sources[0]!.type).toBe('url');
    expect(sources[0]!.url).toBe('https://example.com/article.md');
  });

  it('can be removed after saving', async () => {
    const groupId = await saveUrlArticle({
      url: 'https://example.com/removable.md',
      title: 'Removable',
      content: '# Removable'
    });

    expect(await loadGroups()).toHaveLength(1);

    await removeGroup(groupId);

    expect(await loadGroups()).toHaveLength(0);
    expect(await db.articles.toArray()).toHaveLength(0);
    expect(await db.sources.toArray()).toHaveLength(0);
  });
});
