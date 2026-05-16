import Dexie, { type EntityTable } from 'dexie';
import type { Article, Asset, Group, ReadingState, Source } from './types';

export class ReaderDatabase extends Dexie {
  sources!: EntityTable<Source, 'id'>;
  groups!: EntityTable<Group, 'id'>;
  articles!: EntityTable<Article, 'id'>;
  readingStates!: EntityTable<ReadingState, 'articleId'>;
  assets!: EntityTable<Asset, 'id'>;

  constructor() {
    super('MyMdReaderDatabase');

    this.version(1).stores({
      sources: 'id, type, url, updatedAt',
      groups: 'id, sourceId, offlineStatus, updatedAt, lastReadArticleId',
      articles: 'id, groupId, order, downloadStatus, updatedAt',
      readingStates: 'articleId, groupId, isFavorite, lastReadAt',
      assets: 'id, articleId, status'
    });
  }
}

export const db = new ReaderDatabase();
