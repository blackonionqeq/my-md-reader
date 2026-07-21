import { describe, expect, it } from 'vitest';
import { collectHeadings } from './outline';

describe('collectHeadings', () => {
  it('preserves the existing single-reader heading IDs', () => {
    const container = document.createElement('div');
    container.innerHTML = '<h1>One</h1><h2 id="kept">Two</h2>';

    expect(collectHeadings(container)).toEqual([
      { id: 'heading-0', level: 1, text: 'One' },
      { id: 'kept', level: 2, text: 'Two' }
    ]);
  });

  it('prefixes generated IDs for continuous articles', () => {
    const container = document.createElement('div');
    container.innerHTML = '<h1>One</h1><h3>Three</h3>';

    expect(collectHeadings(container, 'group:article/2')).toEqual([
      { id: 'group-article-2-heading-0', level: 1, text: 'One' },
      { id: 'group-article-2-heading-1', level: 3, text: 'Three' }
    ]);
  });
});
