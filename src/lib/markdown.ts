type MarkdownItModule = typeof import('markdown-it');
type HighlightCoreModule = typeof import('highlight.js/lib/core');
type DomPurifyModule = typeof import('dompurify');
type HighlightLanguageModule = {
  default: HighlightCoreModule['default']['registerLanguage'] extends (
    languageName: string,
    language: infer TLanguage
  ) => void ? TLanguage : never;
};

type MarkdownRenderer = {
  render(content: string): string;
};

let rendererPromise: Promise<MarkdownRenderer> | null = null;

async function createRenderer(): Promise<MarkdownRenderer> {
  const [markdownItModule, highlightCoreModule, domPurifyModule] = await Promise.all([
    import('markdown-it') as Promise<MarkdownItModule>,
    import('highlight.js/lib/core') as Promise<HighlightCoreModule>,
    import('dompurify') as Promise<DomPurifyModule>
  ]);

  const MarkdownIt = markdownItModule.default;
  const hljs = highlightCoreModule.default;
  const DOMPurify = domPurifyModule.default;

  const languageModules = await Promise.all([
    import('highlight.js/lib/languages/bash') as Promise<HighlightLanguageModule>,
    import('highlight.js/lib/languages/javascript') as Promise<HighlightLanguageModule>,
    import('highlight.js/lib/languages/json') as Promise<HighlightLanguageModule>,
    import('highlight.js/lib/languages/markdown') as Promise<HighlightLanguageModule>,
    import('highlight.js/lib/languages/plaintext') as Promise<HighlightLanguageModule>,
    import('highlight.js/lib/languages/sql') as Promise<HighlightLanguageModule>,
    import('highlight.js/lib/languages/typescript') as Promise<HighlightLanguageModule>,
    import('highlight.js/lib/languages/xml') as Promise<HighlightLanguageModule>,
    import('highlight.js/lib/languages/yaml') as Promise<HighlightLanguageModule>
  ]);

  const registeredLanguages: Array<[name: string, aliases: string[]]> = [
    ['bash', ['bash', 'sh', 'shell', 'zsh']],
    ['javascript', ['javascript', 'js', 'jsx']],
    ['json', ['json']],
    ['markdown', ['markdown', 'md']],
    ['plaintext', ['plaintext', 'text', 'txt']],
    ['sql', ['sql']],
    ['typescript', ['typescript', 'ts', 'tsx']],
    ['xml', ['xml', 'html', 'svg']],
    ['yaml', ['yaml', 'yml']]
  ];

  registeredLanguages.forEach(([name, aliases], index) => {
    const languageModule = languageModules[index];
    if (!languageModule) {
      return;
    }

    hljs.registerLanguage(name, languageModule.default);
    aliases.forEach((alias) => {
      if (alias !== name) {
        hljs.registerAliases(alias, { languageName: name });
      }
    });
  });

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
