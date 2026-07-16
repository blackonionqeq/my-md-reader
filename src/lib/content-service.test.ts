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
import { IMAGE_CACHE_NAME } from './image-cache';
import type { Asset } from './types';

class MemoryCache {
  entries = new Map<string, Response>();
  dropWrites = false;

  private key(input: RequestInfo | URL): string {
    return input instanceof Request ? input.url : new URL(String(input), location.href).toString();
  }

  async match(input: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(this.key(input));
  }

  async put(input: RequestInfo | URL, response: Response): Promise<void> {
    if (!this.dropWrites) {
      this.entries.set(this.key(input), response);
    }
  }

  async delete(input: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.key(input));
  }

  async keys(): Promise<Request[]> {
    return Array.from(this.entries.keys(), (url) => new Request(url));
  }
}

class MemoryCacheStorage {
  caches = new Map<string, MemoryCache>();

  async open(name: string): Promise<Cache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.caches.set(name, cache);
    }
    return cache as unknown as Cache;
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.caches.keys());
  }
}

let cacheStorage: MemoryCacheStorage;

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
  cacheStorage = new MemoryCacheStorage();
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: cacheStorage as unknown as CacheStorage
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: {} }
  });
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true
  });
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
  vi.restoreAllMocks();
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
  it('migrates a persisted blob to Cache Storage and renders the original URL', async () => {
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

    expect(article.content).toBe('![cached](https://reader.test/images/cached.bin)');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    const cache = cacheStorage.caches.get(IMAGE_CACHE_NAME)!;
    const cached = await cache.match('https://reader.test/images/cached.bin');
    expect(cached?.headers.get('content-type')).toBe('image/png');
    expect(await cached?.text()).toBe('cached-image');
    expect((await db.assets.get('asset:cached'))?.blob).toBeUndefined();
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

    expect(article.content).toBe('![cover](https://reader.test/images/cover.webp?version=2)');
    const cache = cacheStorage.caches.get(IMAGE_CACHE_NAME)!;
    const cached = await cache.match('https://reader.test/images/cover.webp?version=2');
    expect(cached?.headers.get('content-type')).toBe('image/webp');
  });

  it('keeps the only legacy blob when cache verification fails', async () => {
    const legacyBlob = new NodeBlob(['legacy']) as Blob;
    await db.assets.put({
      id: 'asset:legacy',
      articleId: 'article:3',
      originalUrl: 'https://reader.test/images/legacy.png',
      blob: legacyBlob,
      status: 'downloaded',
      attemptCount: 1,
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z'
    });
    const cache = await cacheStorage.open(IMAGE_CACHE_NAME) as unknown as MemoryCache;
    cache.dropWrites = true;

    const article = await hydrateArticleAssets({
      id: 'article:3',
      groupId: 'group:1',
      order: 3,
      title: 'Legacy',
      content: '![legacy](mdr-asset://asset:legacy)',
      downloadStatus: 'downloaded',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z'
    });

    expect(article.content).toBe('![legacy](https://reader.test/images/legacy.png)');
    const stored = await db.assets.get('asset:legacy');
    expect(stored?.blob).toBeDefined();
    expect(stored?.blob?.size).toBe(legacyBlob.size);
    expect(stored?.status).toBe('pending');
    expect(stored?.lastError).toContain('verification failed');
  });

  it('retains a migrated blob until the service worker controls the page', async () => {
    const serviceWorkerState = { controller: null as object | null };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorkerState
    });
    await db.assets.put({
      id: 'asset:waiting-sw',
      articleId: 'article:4',
      originalUrl: 'https://reader.test/images/waiting.png',
      blob: new NodeBlob(['waiting']) as Blob,
      status: 'downloaded',
      attemptCount: 1,
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z'
    });
    const article = {
      id: 'article:4', groupId: 'group:1', order: 4, title: 'Waiting',
      content: '![waiting](mdr-asset://asset:waiting-sw)',
      downloadStatus: 'downloaded' as const,
      createdAt: '2026-05-17T00:00:00.000Z', updatedAt: '2026-05-17T00:00:00.000Z'
    };

    await hydrateArticleAssets(article);
    expect((await db.assets.get('asset:waiting-sw'))?.blob).toBeDefined();

    serviceWorkerState.controller = {};
    await hydrateArticleAssets(article);
    expect((await db.assets.get('asset:waiting-sw'))?.blob).toBeUndefined();
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

  it('preserves a shared cached URL until its final asset reference is removed', async () => {
    const firstGroupId = await importLocalFiles([new File(['# One'], 'one.md')]);
    const secondGroupId = await importLocalFiles([new File(['# Two'], 'two.md')]);
    const firstArticle = (await loadArticles(firstGroupId))[0]!;
    const secondArticle = (await loadArticles(secondGroupId))[0]!;
    const sharedUrl = 'https://reader.test/shared.png';
    const now = '2026-07-16T00:00:00.000Z';
    await db.assets.bulkPut([
      {
        id: 'asset:shared-1', articleId: firstArticle.id, originalUrl: sharedUrl,
        status: 'downloaded', attemptCount: 1, createdAt: now, updatedAt: now
      },
      {
        id: 'asset:shared-2', articleId: secondArticle.id, originalUrl: sharedUrl,
        status: 'downloaded', attemptCount: 1, createdAt: now, updatedAt: now
      }
    ]);
    const cache = await cacheStorage.open(IMAGE_CACHE_NAME) as unknown as MemoryCache;
    await cache.put(sharedUrl, new Response('shared'));

    await removeGroup(firstGroupId);
    expect(await cache.match(sharedUrl)).toBeDefined();

    await removeGroup(secondGroupId);
    expect(await cache.match(sharedUrl)).toBeUndefined();
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
    const imageCache = await cacheStorage.open(IMAGE_CACHE_NAME) as unknown as MemoryCache;
    await imageCache.put('https://reader.test/image.png', new Response('image'));

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
    expect(cacheStorage.caches.has(IMAGE_CACHE_NAME)).toBe(false);
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

  it('stores downloaded image bytes in Cache Storage without a new IndexedDB blob', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('image-bytes', { status: 200, headers: { 'content-type': 'image/png' } })
    );
    const groupId = await saveUrlArticle({
      url: 'https://example.com/article.md',
      title: 'Cached image',
      content: '# Cached image\n\n![cover](https://cdn.reader.test/cover.png)'
    });

    const [asset] = await db.assets.toArray();
    expect(asset?.status).toBe('downloaded');
    expect(asset?.blob).toBeUndefined();
    expect((await loadArticles(groupId))[0]?.content).toContain(`mdr-asset://${asset?.id}`);
    expect((fetchMock.mock.calls[0]?.[0] as Request).mode).toBe('no-cors');
    const cache = cacheStorage.caches.get(IMAGE_CACHE_NAME)!;
    expect(await cache.match('https://cdn.reader.test/cover.png')).toBeDefined();
    fetchMock.mockRestore();
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
