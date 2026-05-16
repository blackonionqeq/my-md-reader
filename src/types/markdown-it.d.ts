declare module 'markdown-it' {
  interface MarkdownItOptions {
    html?: boolean;
    linkify?: boolean;
    typographer?: boolean;
    highlight?: (str: string, lang: string) => string;
  }

  export default class MarkdownIt {
    constructor(options?: MarkdownItOptions);
    render(markdown: string): string;
  }
}
