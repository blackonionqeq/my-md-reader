import Dexie, { type EntityTable } from 'dexie';
import type { Article, Asset, Group, ReadingState, Source } from './types';

export class ReaderDatabase extends Dexie {
  sources!: EntityTable<Source, 'id'>;
  groups!: EntityTable<Group, 'id'>;
  articles!: EntityTable<Article, 'id'>;
  readingStates!: EntityTable<ReadingState, 'articleId'>;
  assets!: EntityTable<Asset, 'id'>;

  constructor(name = 'MyMdReaderDatabase') {
    super(name);

    this.version(1).stores({
      sources: 'id, type, url, updatedAt',
      groups: 'id, sourceId, offlineStatus, updatedAt, lastReadArticleId',
      articles: 'id, groupId, order, downloadStatus, updatedAt',
      readingStates: 'articleId, groupId, isFavorite, lastReadAt',
      assets: 'id, articleId, status'
    });

    this.version(2).stores({
      sources: 'id, type, url, updatedAt',
      groups: 'id, sourceId, offlineStatus, updatedAt, lastReadArticleId',
      articles: 'id, groupId, order, downloadStatus, updatedAt',
      readingStates: 'articleId, groupId, isFavorite, lastReadAt',
      assets: 'id, articleId, status, nextRetryAt, updatedAt'
    }).upgrade((tx) => {
      return tx.table('assets').toCollection().modify((asset) => {
        asset.status = asset.status ?? 'pending';
        asset.attemptCount = typeof asset.attemptCount === 'number' ? asset.attemptCount : 0;
        asset.createdAt = asset.createdAt ?? new Date().toISOString();
        asset.updatedAt = new Date().toISOString();
        delete asset.localCacheKey;
      });
    });

    this.version(3).stores({
      sources: 'id, type, url, updatedAt',
      groups: 'id, sourceId, offlineStatus, updatedAt, lastReadArticleId',
      articles: 'id, groupId, order, downloadStatus, updatedAt',
      readingStates: 'articleId, groupId, isFavorite, lastReadAt',
      assets: 'id, articleId, status, nextRetryAt, updatedAt'
    }).upgrade((tx) => {
      return tx.table('articles').toCollection().modify((article) => {
        if (article.downloadStatus === 'downloading') {
          article.downloadStatus = 'failed';
          article.errorMessage = 'Download was interrupted. Retry to continue.';
          article.updatedAt = new Date().toISOString();
        }
      });
    });
  }
}

export const db = new ReaderDatabase();
