export type SourceType = 'manifest' | 'local' | 'url';
export type OfflineStatus = 'not_downloaded' | 'partial' | 'downloaded';
export type DownloadStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'failed';
export type AssetStatus = 'pending' | 'downloading' | 'downloaded' | 'failed';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface Source {
  id: string;
  type: SourceType;
  url?: string;
  manifestFingerprint?: string;
  lastCheckedAt?: string;
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
  sourceType?: SourceType;
  sourceUrl?: string;
  sourceLastCheckedAt?: string;
}

export interface Article {
  id: string;
  groupId: string;
  order: number;
  title: string;
  url?: string;
  contentHash?: string;
  downloadedContentHash?: string;
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
  /** Transitional v1 payload. Cache Storage is the binary source of truth. */
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
  contentHash?: string;
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
  schemaVersion: number;
  manifestUrl: string;
  source: Source;
  group: Group;
  articles: Article[];
}

export type ManifestUpdateKind =
  | 'added'
  | 'removed'
  | 'contentChanged'
  | 'metadataChanged'
  | 'unchanged';

export interface ManifestUpdateEntry {
  kind: ManifestUpdateKind;
  articleId: string;
  title: string;
  previousTitle?: string;
  wasDownloaded: boolean;
}

export interface ManifestUpdatePlan {
  groupId: string;
  sourceId: string;
  baseFingerprint: string;
  targetFingerprint: string;
  oldManifestUrl: string;
  newManifestUrl: string;
  oldVersion?: string;
  newVersion?: string;
  sourceUrlChanged: boolean;
  groupMetadataChanged: boolean;
  legacyPrecision: boolean;
  target: ManifestPreview;
  entries: ManifestUpdateEntry[];
}

export type ManifestImportPreview =
  | { kind: 'new'; preview: ManifestPreview }
  | { kind: 'update'; preview: ManifestPreview; plan: ManifestUpdatePlan };

export interface ManifestApplyResult {
  groupId: string;
  downloadedArticleIds: string[];
  failedArticleIds: string[];
  removedArticleIds: string[];
  selectedArticleId?: string;
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
