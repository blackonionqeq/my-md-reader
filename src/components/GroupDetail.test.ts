import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Article, Group } from '../lib/types';
import GroupDetail from './GroupDetail.svelte';

const group: Group = {
  id: 'group-1',
  sourceId: 'source-1',
  title: 'Group',
  articleCount: 2,
  offlineStatus: 'downloaded',
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z'
};

const articles: Article[] = [1, 2].map((order) => ({
  id: `article-${order}`,
  groupId: group.id,
  order,
  title: `Article ${order}`,
  content: 'Body',
  downloadStatus: 'downloaded',
  createdAt: group.createdAt,
  updatedAt: group.updatedAt
}));

describe('GroupDetail continuous reading action', () => {
  it('explains why the action is disabled', async () => {
    const target = document.createElement('div');
    const component = mount(GroupDetail, {
      target,
      props: {
        group,
        articles,
        continuousReadingAvailable: false,
        continuousReadingDisabledReason: 'Download every article first.'
      }
    });
    flushSync();

    const button = target.querySelector<HTMLButtonElement>('button.continuous')!;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Download every article first.');
    await unmount(component);
  });

  it('enters the mode only through an enabled user action', async () => {
    const onEnterContinuousReading = vi.fn();
    const target = document.createElement('div');
    const component = mount(GroupDetail, {
      target,
      props: { group, articles, continuousReadingAvailable: true, onEnterContinuousReading }
    });
    flushSync();

    target.querySelector<HTMLButtonElement>('button.continuous')!.click();
    flushSync();
    expect(onEnterContinuousReading).toHaveBeenCalledOnce();
    await unmount(component);
  });
});
