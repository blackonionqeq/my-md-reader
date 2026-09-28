import type MarkdownIt from 'markdown-it';

// Parse-only math support: TeX source is emitted as escaped placeholders and
// typeset later by `renderMathBlocks`, so KaTeX stays out of the Markdown chunk.

type InlineRule = Parameters<MarkdownIt['inline']['ruler']['before']>[2];
type BlockRule = Parameters<MarkdownIt['block']['ruler']['before']>[2];

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;
const OPEN_PAREN = 0x28;

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

// Pandoc rules: the opening `$` must be followed by a non-space, and the
// closing `$` must be preceded by a non-space and not followed by a digit.
// This keeps prose like "costs $5 and $10" literal.
function findInlineDollarClose(src: string, start: number, max: number): number {
  if (start >= max || isWhitespace(src.charCodeAt(start))) {
    return -1;
  }

  let pos = start;
  while (pos < max) {
    const code = src.charCodeAt(pos);
    if (code === BACKSLASH) {
      pos += 2;
      continue;
    }
    if (code === DOLLAR && pos > start) {
      const before = src.charCodeAt(pos - 1);
      const after = pos + 1 < max ? src.charCodeAt(pos + 1) : -1;
      if (!isWhitespace(before) && !isDigit(after)) {
        return pos;
      }
    }
    pos += 1;
  }

  return -1;
}

const mathInline: InlineRule = (state, silent) => {
  const { src, pos: start, posMax: max } = state;
  const code = src.charCodeAt(start);
  let content: string;
  let type: 'math_inline' | 'math_inline_display';
  let markup: string;
  let end: number;

  if (code === BACKSLASH) {
    // `\(...\)`; any other backslash sequence falls through to the escape rule.
    if (src.charCodeAt(start + 1) !== OPEN_PAREN) return false;
    const close = src.indexOf('\\)', start + 2);
    if (close < 0 || close + 2 > max) return false;
    content = src.slice(start + 2, close);
    type = 'math_inline';
    markup = '\\(';
    end = close + 2;
  } else if (code === DOLLAR) {
    if (src.charCodeAt(start + 1) === DOLLAR) {
      const close = src.indexOf('$$', start + 2);
      if (close < 0 || close + 2 > max) return false;
      content = src.slice(start + 2, close);
      type = 'math_inline_display';
      markup = '$$';
      end = close + 2;
    } else {
      const close = findInlineDollarClose(src, start + 1, max);
      if (close < 0) return false;
      content = src.slice(start + 1, close);
      type = 'math_inline';
      markup = '$';
      end = close + 1;
    }
  } else {
    return false;
  }

  if (!content.trim()) return false;

  if (!silent) {
    const token = state.push(type, 'math', 0);
    token.content = content;
    token.markup = markup;
  }
  state.pos = end;
  return true;
};

const BLOCK_DELIMITERS: Array<[open: string, close: string]> = [
  ['$$', '$$'],
  ['\\[', '\\]']
];

const mathBlock: BlockRule = (state, startLine, endLine, silent) => {
  const indent = (line: number) => state.sCount[line] ?? 0;
  const lineStart = (line: number) => (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
  const lineEnd = (line: number) => state.eMarks[line] ?? 0;
  const lineText = (line: number) => state.src.slice(lineStart(line), lineEnd(line));

  if (indent(startLine) - state.blkIndent >= 4) return false;

  const firstLine = lineText(startLine);
  const delimiters = BLOCK_DELIMITERS.find(([open]) => firstLine.startsWith(open));
  if (!delimiters) return false;
  const [open, close] = delimiters;

  const rest = firstLine.slice(open.length).trimEnd();
  const lines: string[] = [];
  let lastLine = startLine;
  let closed = false;

  if (rest.includes(close)) {
    // Single-line block: the closing delimiter must end the line, otherwise
    // this is inline math inside a paragraph.
    if (!rest.endsWith(close)) return false;
    lines.push(rest.slice(0, -close.length));
    closed = true;
  } else {
    if (rest) lines.push(rest);
    for (let line = startLine + 1; line < endLine; line += 1) {
      const text = lineText(line);
      const isBlank = lineStart(line) >= lineEnd(line);
      if (!isBlank && indent(line) < state.blkIndent) break;

      const trimmed = text.trimEnd();
      if (trimmed.endsWith(close)) {
        lines.push(trimmed.slice(0, -close.length));
        lastLine = line;
        closed = true;
        break;
      }
      lines.push(text);
    }
  }

  const content = lines.join('\n').trim();
  if (!closed || !content) return false;
  if (silent) return true;

  state.line = lastLine + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = content;
  token.markup = open;
  token.map = [startLine, state.line];
  return true;
};

export function markdownMathPlugin(md: MarkdownIt): void {
  const escape = md.utils.escapeHtml;

  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list']
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math-inline">${escape(tokens[idx]?.content ?? '')}</span>`;
  md.renderer.rules.math_inline_display = (tokens, idx) =>
    `<span class="math-display">${escape(tokens[idx]?.content ?? '')}</span>`;
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-display">${escape(tokens[idx]?.content ?? '')}</div>\n`;

  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const lang = token?.info.trim().split(/\s+/)[0]?.toLowerCase();
    if (token && lang === 'math') {
      return `<div class="math-display">${escape(token.content.trim())}</div>\n`;
    }
    return defaultFence
      ? defaultFence(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };
}
