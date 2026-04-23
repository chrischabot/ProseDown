import katex from 'katex';
import type MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';

function renderSafe(src: string, display: boolean): string {
  try {
    return katex.renderToString(src, {
      throwOnError: false,
      displayMode: display,
      output: 'html',
      strict: 'ignore',
      trust: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `<span class="katex-error" title="${escapeAttr(msg)}">${escapeText(src)}</span>`;
  }
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function isValidDelim(state: StateInline, pos: number) {
  const prev = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
  const next = pos + 1 < state.src.length ? state.src.charCodeAt(pos + 1) : -1;
  // $ should not touch digits on both sides (e.g. "$5 or $10"), and not
  // have a trailing space inside the opening delimiter.
  const canOpen = next !== 0x20 && next !== 0x09 && next !== -1 &&
    !(prev >= 0x30 && prev <= 0x39 && next >= 0x30 && next <= 0x39);
  const canClose = prev !== 0x20 && prev !== 0x09 && prev !== -1;
  return { canOpen, canClose };
}

function inlineMath(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false;
  // Don't start inline math at $$
  if (state.src.charCodeAt(state.pos + 1) === 0x24) return false;

  const { canOpen } = isValidDelim(state, state.pos);
  if (!canOpen) return false;

  const start = state.pos + 1;
  let match = start;
  while ((match = state.src.indexOf('$', match)) !== -1) {
    // ignore escaped $
    let escapes = 0;
    let p = match - 1;
    while (p >= 0 && state.src.charCodeAt(p) === 0x5c /* \ */) { escapes++; p--; }
    if (escapes % 2 === 1) { match++; continue; }
    break;
  }
  if (match === -1) return false;

  const { canClose } = isValidDelim(state, match);
  if (!canClose) return false;

  if (match === start) {
    state.pos = start + 1;
    return true;
  }

  if (!silent) {
    const token = state.push('math_inline', 'span', 0);
    token.markup = '$';
    token.content = state.src.slice(start, match);
  }
  state.pos = match + 1;
  return true;
}

function blockMath(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  const maxStart = state.eMarks[startLine];
  if (startPos + 2 > maxStart) return false;
  if (state.src.charCodeAt(startPos) !== 0x24 || state.src.charCodeAt(startPos + 1) !== 0x24) return false;

  const firstLineContent = state.src.slice(startPos + 2, maxStart);
  let nextLine = startLine;
  let contentEnd = -1;
  let lastLineContent = '';
  let found = false;

  // $$ expr $$ on a single line
  const singleLineClose = firstLineContent.indexOf('$$');
  if (singleLineClose !== -1) {
    if (silent) return true;
    const content = firstLineContent.slice(0, singleLineClose).trim();
    const token = state.push('math_block', 'div', 0);
    token.block = true;
    token.content = content;
    token.markup = '$$';
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }

  for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineMax = state.eMarks[nextLine];
    const line = state.src.slice(lineStart, lineMax);
    const idx = line.indexOf('$$');
    if (idx !== -1) {
      lastLineContent = line.slice(0, idx);
      contentEnd = nextLine;
      found = true;
      break;
    }
  }
  if (!found) return false;
  if (silent) return true;

  const middle: string[] = [];
  if (firstLineContent.trim().length > 0) middle.push(firstLineContent);
  for (let i = startLine + 1; i < contentEnd; i++) {
    middle.push(state.src.slice(state.bMarks[i] + state.tShift[i], state.eMarks[i]));
  }
  if (lastLineContent.trim().length > 0) middle.push(lastLineContent);
  const content = middle.join('\n').trim();

  const token = state.push('math_block', 'div', 0);
  token.block = true;
  token.content = content;
  token.markup = '$$';
  token.map = [startLine, contentEnd + 1];
  state.line = contentEnd + 1;
  return true;
}

export function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'math_inline', inlineMath);
  md.block.ruler.after('blockquote', 'math_block', blockMath, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.renderer.rules.math_inline = (tokens, idx) => renderSafe(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="katex-block">${renderSafe(tokens[idx].content, true)}</div>\n`;
}

export function hasMath(src: string): boolean {
  // cheap pre-scan, used to decide whether to ship KaTeX CSS
  return /(^|[^\\])\$\$/.test(src) || /(^|[^\\])\$[^\s$][^$]*\$/.test(src);
}