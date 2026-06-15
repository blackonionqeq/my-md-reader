type MarkdownItModule = typeof import('markdown-it');
type HighlightCoreModule = typeof import('highlight.js/lib/core');
type DomPurifyModule = typeof import('dompurify');
type MermaidModule = typeof import('mermaid');
type HighlightLanguageModule = {
  default: HighlightCoreModule['default']['registerLanguage'] extends (
    languageName: string,
    language: infer TLanguage
  ) => void ? TLanguage : never;
};

type MarkdownRenderer = {
  render(content: string): string;
};

const MERMAID_ALIASES = new Set(['mermaid', 'mmd']);

// DOMPurify's default allowlist rejects blob: URIs, which hydrated offline
// images rely on (object URLs created from cached IndexedDB blobs).
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let rendererPromise: Promise<MarkdownRenderer> | null = null;

async function createRenderer(): Promise<MarkdownRenderer> {
  const [markdownItModule, highlightCoreModule, domPurifyModule] = await Promise.all([
    import('markdown-it') as Promise<MarkdownItModule>,
    import('highlight.js/lib/core') as Promise<HighlightCoreModule>,
    import('dompurify') as Promise<DomPurifyModule>,
    import('highlight.js/styles/github.css')
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
    import('highlight.js/lib/languages/rust') as Promise<HighlightLanguageModule>,
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
    ['rust', ['rust', 'rs']],
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
      if (lang && MERMAID_ALIASES.has(lang.toLowerCase())) {
        return `<pre class="mermaid">${escapeHtml(str.trimEnd())}</pre>`;
      }

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
      return DOMPurify.sanitize(rawHtml, { ALLOWED_URI_REGEXP });
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

let mermaidPromise: Promise<MermaidModule> | null = null;

function resolveEffectiveTheme(): 'dark' | 'default' {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'default';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const nodes = container.querySelectorAll<HTMLPreElement>('pre.mermaid');
  if (nodes.length === 0) {
    return;
  }

  if (!mermaidPromise) {
    mermaidPromise = import('mermaid') as Promise<MermaidModule>;
  }

  const { default: mermaid } = await mermaidPromise;
  mermaid.initialize({
    startOnLoad: false,
    theme: resolveEffectiveTheme(),
    securityLevel: 'strict',
  });

  await mermaid.run({ nodes: Array.from(nodes) });
}
