type MarkdownItModule = typeof import('markdown-it');
type HighlightJsModule = typeof import('highlight.js');
type DomPurifyModule = typeof import('dompurify');

type MarkdownRenderer = {
  render(content: string): string;
};

let rendererPromise: Promise<MarkdownRenderer> | null = null;

async function createRenderer(): Promise<MarkdownRenderer> {
  const [markdownItModule, highlightJsModule, domPurifyModule] = await Promise.all([
    import('markdown-it') as Promise<MarkdownItModule>,
    import('highlight.js') as Promise<HighlightJsModule>,
    import('dompurify') as Promise<DomPurifyModule>
  ]);

  const MarkdownIt = markdownItModule.default;
  const hljs = highlightJsModule.default;
  const DOMPurify = domPurifyModule.default;

  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    highlight(str: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
        } catch {
          return '';
        }
      }

      return '';
    }
  });

  return {
    render(content: string): string {
      const rawHtml = markdown.render(content);
      return DOMPurify.sanitize(rawHtml);
    }
  };
}

async function getRenderer(): Promise<MarkdownRenderer> {
  if (!rendererPromise) {
    rendererPromise = createRenderer();
  }

  return rendererPromise;
}

export async function renderMarkdownToHtml(content: string): Promise<string> {
  const renderer = await getRenderer();
  return renderer.render(content);
}
