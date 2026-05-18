import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml } from './markdown';

describe('renderMarkdownToHtml', () => {
  it('renders basic markdown to HTML', async () => {
    const html = await renderMarkdownToHtml('# Hello');
    expect(html).toContain('<h1>Hello</h1>');
  });

  it('renders a mermaid code block as <pre class="mermaid">', async () => {
    const input = '```mermaid\nflowchart LR\n    A --> B\n```';
    const html = await renderMarkdownToHtml(input);
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain('A --&gt; B');
    expect(html).not.toContain('class="hljs"');
  });

  it('accepts the mmd alias for mermaid blocks', async () => {
    const input = '```mmd\ngraph TD\n    X --> Y\n```';
    const html = await renderMarkdownToHtml(input);
    expect(html).toContain('<pre class="mermaid">');
  });

  it('still syntax-highlights non-mermaid code blocks', async () => {
    const input = '```javascript\nconst x = 1;\n```';
    const html = await renderMarkdownToHtml(input);
    expect(html).toContain('class="hljs"');
    expect(html).not.toContain('class="mermaid"');
  });
});
