import { flushSync, mount, unmount } from 'svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DownloadProgress } from '../lib/content-service';
import type { Group, ManifestUpdatePlan, Source } from '../lib/types';
import ManifestUpdateDialog from './ManifestUpdateDialog.svelte';

const timestamp = '2026-07-21T00:00:00.000Z';

const source: Source = {
  id: 'source-1',
  type: 'manifest',
  url: 'https://example.com/manifest.json',
  createdAt: timestamp,
  updatedAt: timestamp
};

const group: Group = {
  id: 'group-1',
  sourceId: source.id,
  title: 'Group',
  articleCount: 2,
  offlineStatus: 'downloaded',
  createdAt: timestamp,
  updatedAt: timestamp
};

const plan: ManifestUpdatePlan = {
  groupId: group.id,
  sourceId: source.id,
  baseFingerprint: 'base',
  targetFingerprint: 'target',
  oldManifestUrl: source.url ?? '',
  newManifestUrl: source.url ?? '',
  sourceUrlChanged: false,
  groupMetadataChanged: false,
  legacyPrecision: false,
  target: { schemaVersion: 1, manifestUrl: source.url ?? '', source, group, articles: [] },
  entries: [
    { kind: 'contentChanged', articleId: 'article-1', title: 'Article 1', wasDownloaded: true },
    { kind: 'added', articleId: 'article-2', title: 'Article 2', wasDownloaded: false }
  ]
};

function render(props: { busy?: boolean; progress?: DownloadProgress | null }) {
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(ManifestUpdateDialog, {
    target,
    props: { open: true, plan, ...props }
  });
  flushSync();
  return {
    text: target.textContent ?? '',
    bar: target.querySelector('progress'),
    cleanup: () => {
      void unmount(component);
      target.remove();
    }
  };
}

describe('ManifestUpdateDialog progress feedback', () => {
  // jsdom ships <dialog> without the modal methods.
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  });

  it('lists the diff while idle', () => {
    const { text, bar, cleanup } = render({ busy: false });
    expect(text).toContain('Article 1');
    expect(text).toContain('Article 2');
    expect(bar).toBeNull();
    cleanup();
  });

  it('reports the pre-download transaction phase indeterminately', () => {
    const { text, bar, cleanup } = render({ busy: true, progress: null });
    expect(text).toContain('Applying changes…');
    // No value attribute renders an indeterminate bar.
    expect(bar?.hasAttribute('value')).toBe(false);
    cleanup();
  });

  it('counts changed articles rather than the whole group', () => {
    const { text, cleanup } = render({
      busy: true,
      progress: { articleIndex: 2, articleTotal: 3 }
    });
    expect(text.replace(/\s+/g, ' ')).toContain('Updating 2 of 3 changed articles');
    cleanup();
  });

  it('blends image progress into the completed fraction', () => {
    const { text, bar, cleanup } = render({
      busy: true,
      progress: { articleIndex: 2, articleTotal: 4, assetIndex: 1, assetTotal: 2 }
    });
    expect(text).toContain('Image 1 of 2');
    // One of four articles done, plus half of the second: 1.5 / 4.
    expect(bar?.value).toBeCloseTo(0.375);
    cleanup();
  });

  it('never exceeds a full bar on the final asset', () => {
    const { bar, cleanup } = render({
      busy: true,
      progress: { articleIndex: 1, articleTotal: 1, assetIndex: 5, assetTotal: 5 }
    });
    expect(bar?.value).toBe(1);
    cleanup();
  });
});
