import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml, highlightCodeBlocks } from './markdown';

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

  it('keeps blob: image sources used by hydrated offline assets', async () => {
    const input = '![diagram](blob:http://localhost:5173/0f9c8a2e-demo)';
    const html = await renderMarkdownToHtml(input);
    expect(html).toContain('src="blob:http://localhost:5173/0f9c8a2e-demo"');
  });

  it('keeps https image sources', async () => {
    const input = '![cat](https://example.com/cat.png)';
    const html = await renderMarkdownToHtml(input);
    expect(html).toContain('src="https://example.com/cat.png"');
  });

  it('still strips javascript: URLs', async () => {
    const input = '[click](javascript:alert(1))';
    const html = await renderMarkdownToHtml(input);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<a');
  });

  it('outputs code blocks with language class for deferred highlighting', async () => {
    const input = '```javascript\nconst x = 1;\n```';
    const html = await renderMarkdownToHtml(input);
    expect(html).toContain('class="language-javascript"');
    expect(html).not.toContain('class="mermaid"');
  });
});

describe('highlightCodeBlocks', () => {
  async function renderIntoContainer(markdown: string): Promise<HTMLElement> {
    const html = await renderMarkdownToHtml(markdown);
    const container = document.createElement('div');
    container.innerHTML = html;
    return container;
  }

  it('applies hljs class and data-highlighted to code blocks', async () => {
    const container = await renderIntoContainer('```javascript\nconst x = 1;\n```');
    await highlightCodeBlocks(container);

    const code = container.querySelector('code')!;
    expect(code.classList.contains('hljs')).toBe(true);
    expect(code.getAttribute('data-highlighted')).toBe('yes');
    expect(code.innerHTML).toContain('hljs-');
  });

  it('skips mermaid blocks', async () => {
    const input = '```mermaid\nflowchart LR\n    A --> B\n```\n\n```javascript\nlet y = 2;\n```';
    const container = await renderIntoContainer(input);
    await highlightCodeBlocks(container);

    const mermaidPre = container.querySelector('pre.mermaid')!;
    expect(mermaidPre.classList.contains('hljs')).toBe(false);
    expect(mermaidPre.querySelector('[data-highlighted]')).toBeNull();

    const jsCode = container.querySelector('code.language-javascript')!;
    expect(jsCode.classList.contains('hljs')).toBe(true);
  });

  it('is a no-op when there are no code blocks', async () => {
    const container = await renderIntoContainer('# Just a heading\n\nSome text.');
    await highlightCodeBlocks(container);

    expect(container.querySelector('.hljs')).toBeNull();
    expect(container.querySelector('[data-highlighted]')).toBeNull();
  });
});
