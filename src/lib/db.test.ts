import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { ReaderDatabase } from './db';

const databaseNames: string[] = [];

afterEach(async () => {
  for (const name of databaseNames.splice(0)) {
    await Dexie.delete(name);
  }
});

describe('ReaderDatabase v3 migration', () => {
  it('preserves existing data and recovers interrupted article downloads', async () => {
    const name = `reader-migration-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      sources: 'id, type, url, updatedAt',
      groups: 'id, sourceId, offlineStatus, updatedAt, lastReadArticleId',
      articles: 'id, groupId, order, downloadStatus, updatedAt',
      readingStates: 'articleId, groupId, isFavorite, lastReadAt',
      assets: 'id, articleId, status, nextRetryAt, updatedAt'
    });
    await legacy.open();
    await legacy.table('sources').put({
      id: 'manifest:https://reader.test/manifest.json',
      type: 'manifest',
      url: 'https://reader.test/manifest.json',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z'
    });
    await legacy.table('groups').put({
      id: 'course',
      sourceId: 'manifest:https://reader.test/manifest.json',
      title: 'Course',
      articleCount: 1,
      offlineStatus: 'partial',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z'
    });
    await legacy.table('articles').put({
      id: 'course:a1',
      groupId: 'course',
      order: 1,
      title: 'One',
      url: 'https://reader.test/a1.md',
      content: '# Cached',
      downloadStatus: 'downloading',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z'
    });
    await legacy.table('readingStates').put({
      articleId: 'course:a1',
      groupId: 'course',
      scrollPosition: 42,
      progressRatio: 0.5,
      isFavorite: true,
      lastReadAt: '2026-07-20T00:00:00.000Z'
    });
    await legacy.table('assets').put({
      id: 'asset:1',
      articleId: 'course:a1',
      originalUrl: 'https://reader.test/image.png',
      status: 'downloaded',
      attemptCount: 1,
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z'
    });
    legacy.close();

    const migrated = new ReaderDatabase(name);
    await migrated.open();

    expect(migrated.verno).toBe(3);
    expect(await migrated.sources.count()).toBe(1);
    expect(await migrated.groups.count()).toBe(1);
    expect(await migrated.readingStates.get('course:a1')).toMatchObject({ isFavorite: true });
    expect(await migrated.assets.get('asset:1')).toMatchObject({ originalUrl: 'https://reader.test/image.png' });
    expect(await migrated.articles.get('course:a1')).toMatchObject({
      content: '# Cached',
      downloadStatus: 'failed',
      errorMessage: 'Download was interrupted. Retry to continue.'
    });
    migrated.close();
  });
});
