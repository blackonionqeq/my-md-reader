import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml, renderMathBlocks } from './markdown';

describe('math parsing', () => {
  it('emits inline placeholders for $...$ and \\(...\\)', async () => {
    const html = await renderMarkdownToHtml('Energy $E = mc^2$ and \\(a_1 * b_2\\).');
    expect(html).toContain('<span class="math-inline">E = mc^2</span>');
    expect(html).toContain('<span class="math-inline">a_1 * b_2</span>');
  });

  it('keeps TeX away from emphasis parsing', async () => {
    const html = await renderMarkdownToHtml('$a_1 + b_2 * c_3 * d$');
    expect(html).toContain('<span class="math-inline">a_1 + b_2 * c_3 * d</span>');
    expect(html).not.toContain('<em>');
  });

  it('leaves currency amounts literal', async () => {
    const html = await renderMarkdownToHtml('It costs $5 and $10 today.');
    expect(html).not.toContain('math-inline');
    expect(html).toContain('It costs $5 and $10 today.');
  });

  it('rejects a $ followed by whitespace as an opener', async () => {
    const html = await renderMarkdownToHtml('Pay $ 5 or $ 6.');
    expect(html).not.toContain('math-inline');
  });

  it('treats escaped dollars as literal text', async () => {
    const html = await renderMarkdownToHtml('Price: \\$x\\$ each.');
    expect(html).not.toContain('math-inline');
    expect(html).toContain('Price: $x$ each.');
  });

  it('allows escaped dollars inside inline math', async () => {
    const html = await renderMarkdownToHtml('$\\$5 + x$');
    expect(html).toContain('<span class="math-inline">\\$5 + x</span>');
  });

  it('does not parse math inside code spans or code blocks', async () => {
    const html = await renderMarkdownToHtml('Use `$x$` literally.\n\n```\n$$y$$\n```');
    expect(html).not.toContain('math-');
    expect(html).toContain('<code>$x$</code>');
  });

  it('renders multi-line $$ and \\[ blocks as display placeholders', async () => {
    const html = await renderMarkdownToHtml(
      'Before\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n\\[\na < b\n\\]\n\nAfter'
    );
    expect(html).toContain('<div class="math-display">\\int_0^1 x\\,dx</div>');
    expect(html).toContain('<div class="math-display">a &lt; b</div>');
    expect(html).toContain('<p>After</p>');
  });

  it('renders single-line $$ blocks', async () => {
    const html = await renderMarkdownToHtml('$$ x^2 $$');
    expect(html).toContain('<div class="math-display">x^2</div>');
  });

  it('renders inline $$ within a paragraph as display math', async () => {
    const html = await renderMarkdownToHtml('Here $$x^2$$ inline.');
    expect(html).toContain('<span class="math-display">x^2</span>');
  });

  it('renders ```math fences as display placeholders', async () => {
    const html = await renderMarkdownToHtml('```math\n\\frac{1}{2}\n```');
    expect(html).toContain('<div class="math-display">\\frac{1}{2}</div>');
    expect(html).not.toContain('<pre');
  });

  it('does not consume the rest of the document for an unclosed $$', async () => {
    const html = await renderMarkdownToHtml('$$\nx\n\n# Heading');
    expect(html).not.toContain('math-display');
    expect(html).toContain('<h1>Heading</h1>');
  });

  it('escapes HTML in TeX source', async () => {
    const html = await renderMarkdownToHtml('$<img src=x onerror=alert(1)>$');
    expect(html).not.toContain('<img');
  });
});

describe('renderMathBlocks', () => {
  async function renderIntoContainer(markdown: string): Promise<HTMLElement> {
    const container = document.createElement('div');
    container.innerHTML = await renderMarkdownToHtml(markdown);
    return container;
  }

  it('typesets inline and display placeholders with KaTeX', async () => {
    const container = await renderIntoContainer('Inline $x^2$.\n\n$$\ny = mx + b\n$$');
    await renderMathBlocks(container);

    expect(container.querySelector('.math-inline .katex')).not.toBeNull();
    expect(container.querySelector('.math-display .katex-display')).not.toBeNull();
  });

  it('shows invalid TeX as an error instead of throwing', async () => {
    const container = await renderIntoContainer('$\\frac{1}$');
    await expect(renderMathBlocks(container)).resolves.toBeUndefined();
    expect(container.querySelector('.katex-error')).not.toBeNull();
  });

  it('is idempotent', async () => {
    const container = await renderIntoContainer('$x$');
    await renderMathBlocks(container);
    const first = container.innerHTML;
    await renderMathBlocks(container);
    expect(container.innerHTML).toBe(first);
  });

  it('is a no-op without math', async () => {
    const container = await renderIntoContainer('Plain text.');
    await renderMathBlocks(container);
    expect(container.querySelector('.katex')).toBeNull();
  });
});
