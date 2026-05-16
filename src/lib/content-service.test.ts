import { describe, expect, it } from 'vitest';
import {
  buildOfflineMarkdown,
  calculateGroupOfflineStatus,
  computeNextRetryAt,
  extractMarkdownImageUrls,
  rewriteMarkdownImageUrls
} from './content-service';
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
