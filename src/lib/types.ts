export type SourceType = 'manifest' | 'local' | 'url';
export type OfflineStatus = 'not_downloaded' | 'partial' | 'downloaded';
export type DownloadStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'failed';
export type AssetStatus = 'pending' | 'downloading' | 'downloaded' | 'failed';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface Source {
  id: string;
  type: SourceType;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  sourceId: string;
  title: string;
  description?: string;
  version?: string;
  articleCount: number;
  offlineStatus: OfflineStatus;
  lastReadArticleId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupListItem extends Group {
  lastReadAt?: string;
  lastReadTitle?: string;
}

export interface Article {
  id: string;
  groupId: string;
  order: number;
  title: string;
  url?: string;
  content?: string;
  downloadStatus: DownloadStatus;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingState {
  articleId: string;
  groupId: string;
  scrollPosition: number;
  progressRatio: number;
  isFavorite: boolean;
  lastReadAt: string;
}

export interface Asset {
  id: string;
  articleId: string;
  originalUrl: string;
  blob?: Blob;
  mimeType?: string;
  status: AssetStatus;
  attemptCount: number;
  nextRetryAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReaderSettings {
  theme: ThemeMode;
  fontSize: number;
}

export interface LastOpened {
  groupId: string;
  articleId: string;
  directoryScrollTop?: number;
}

export interface ManifestArticleInput {
  id: string;
  order?: number;
  title: string;
  url: string;
}

export interface ManifestFile {
  schemaVersion: number;
  id: string;
  title: string;
  description?: string;
  version?: string;
  articles: ManifestArticleInput[];
}

export interface ManifestPreview {
  manifestUrl: string;
  source: Source;
  group: Group;
  articles: Article[];
}

export interface TemporaryArticle {
  id: string;
  groupId: string;
  order: number;
  title: string;
  content: string;
  fileName: string;
  isTemporary: true;
}

export interface UrlArticlePreview {
  url: string;
  title: string;
  content: string;
}

export type ReaderArticle = Article | TemporaryArticle;

export interface OutlineHeading {
  id: string;
  level: number;
  text: string;
}
