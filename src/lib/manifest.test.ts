import { describe, expect, it } from 'vitest';
import { normalizeManifestPreview, resolveManifestArticleUrl, validateManifest } from './manifest';

describe('validateManifest', () => {
  it('accepts a valid manifest and normalizes optional order', () => {
    const manifest = validateManifest({
      schemaVersion: 1,
      id: 'course-1',
      title: 'Course 1',
      articles: [
        { id: 'a1', title: 'Intro', url: '001.md' },
        { id: 'a2', title: 'Chapter', url: '002.md', order: 7 }
      ]
    });

    expect(manifest.articles).toHaveLength(2);
    expect(manifest.articles[1]?.order).toBe(7);
  });

  it('rejects malformed manifests with a clear error', () => {
    expect(() => validateManifest({ id: 'bad' })).toThrow(/schemaVersion/);
  });
});

describe('resolveManifestArticleUrl', () => {
  it('resolves relative article urls against the manifest url', () => {
    expect(resolveManifestArticleUrl('https://reader.test/books/manifest.json', 'articles/001.md'))
      .toBe('https://reader.test/books/articles/001.md');
  });
});

describe('normalizeManifestPreview', () => {
  it('generates ordered article records', () => {
    const preview = normalizeManifestPreview('https://reader.test/manifest.json', {
      schemaVersion: 1,
      id: 'group-1',
      title: 'Group 1',
      articles: [
        { id: 'a1', title: 'One', url: '1.md' },
        { id: 'a2', title: 'Two', url: '2.md', order: 9 }
      ]
    });

    expect(preview.group.id).toBe('group-1');
    expect(preview.articles[0]?.order).toBe(1);
    expect(preview.articles[1]?.order).toBe(9);
    expect(preview.articles[0]?.url).toBe('https://reader.test/1.md');
  });
});
