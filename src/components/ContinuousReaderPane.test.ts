import { flushSync, mount, tick, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article, Group } from '../lib/types';
import { loadReadingState } from '../lib/content-service';
import ContinuousReaderPane from './ContinuousReaderPane.svelte';

vi.mock('../lib/content-service', () => ({
  hydrateArticleAssets: vi.fn(async (article: Article) => article),
  loadReadingState: vi.fn(async () => undefined)
}));

vi.mock('../lib/markdown', () => ({
  renderMarkdownToHtml: vi.fn(async (content: string) => `<p>${content}</p>`),
  highlightCodeBlocks: vi.fn(async () => undefined),
  renderMermaidBlocks: vi.fn(async () => undefined)
}));

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  disconnected = false;
  observe = vi.fn();
  unobserve = vi.fn();

  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] { return []; }
  root = null;
  rootMargin = '';
  thresholds = [];
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  disconnected = false;
  observe = vi.fn();
  unobserve = vi.fn();

  constructor(_callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

const group: Group = {
  id: 'group-1',
  sourceId: 'source-1',
  title: 'Test group',
  articleCount: 5,
  offlineStatus: 'downloaded',
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z'
};

const articles: Article[] = Array.from({ length: 5 }, (_, index) => ({
  id: `article-${index + 1}`,
  groupId: group.id,
  order: index + 1,
  title: `Article ${index + 1}`,
  content: `Body ${index + 1}`,
  downloadStatus: 'downloaded',
  createdAt: group.createdAt,
  updatedAt: group.updatedAt
}));

async function settle(): Promise<void> {
  await tick();
  await Promise.resolve();
  flushSync();
  await tick();
}

describe('ContinuousReaderPane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    FakeIntersectionObserver.instances = [];
    FakeResizeObserver.instances = [];
    vi.mocked(loadReadingState).mockResolvedValue(undefined);
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '(max-width: 900px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));
  });

  it('mounts only the previous, current, and next article bodies', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const pane = mount(ContinuousReaderPane, {
      target,
      props: { group, articles, initialArticleId: 'article-3' }
    });

    await settle();
    expect(target.querySelectorAll('.article-slot')).toHaveLength(5);
    await vi.waitFor(() => {
      expect(target.querySelectorAll('.continuous-article-body')).toHaveLength(3);
    });
    expect(target.querySelectorAll('.continuous-article-body')).toHaveLength(3);
    expect(target.querySelector('[data-article-id="article-1"] .continuous-article-body')).toBeNull();
    expect(target.querySelector('[data-article-id="article-5"] .continuous-article-body')).toBeNull();

    await unmount(pane);
  });

  it('replaces the render window on a distant jump and cleans up observers', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const pane = mount(ContinuousReaderPane, {
      target,
      props: { group, articles, initialArticleId: 'article-1' }
    });

    await settle();
    await pane.jumpToArticle('article-5');
    await settle();

    await vi.waitFor(() => {
      expect(target.querySelectorAll('.continuous-article-body')).toHaveLength(2);
    });
    expect(target.querySelectorAll('.continuous-article-body')).toHaveLength(2);
    expect(target.querySelector('[data-article-id="article-4"] .continuous-article-body')).not.toBeNull();
    expect(target.querySelector('[data-article-id="article-5"] .continuous-article-body')).not.toBeNull();
    expect(target.querySelector('[data-article-id="article-1"] .continuous-article-body')).toBeNull();

    await unmount(pane);
    expect(FakeIntersectionObserver.instances.every((observer) => observer.disconnected)).toBe(true);
    expect(FakeResizeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
  });

  it('restores the initial article-local scroll position once', async () => {
    vi.mocked(loadReadingState).mockResolvedValue({
      articleId: 'article-3',
      groupId: group.id,
      scrollPosition: 320,
      progressRatio: 0.25,
      isFavorite: false,
      lastReadAt: group.updatedAt
    });
    const target = document.createElement('div');
    document.body.append(target);
    const pane = mount(ContinuousReaderPane, {
      target,
      props: { group, articles, initialArticleId: 'article-3' }
    });

    await vi.waitFor(() => {
      expect((target.querySelector('.continuous-surface') as HTMLElement).scrollTop).toBe(320);
    });

    await unmount(pane);
  });
});
