import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import footnote from 'markdown-it-footnote';
// @ts-expect-error - markdown-it-task-lists has no bundled types
import tasklists from 'markdown-it-task-lists';
// @ts-expect-error - markdown-it-attrs has no bundled types
import attrs from 'markdown-it-attrs';
import { mathPlugin } from './math.js';
import { alertsPlugin } from './alerts.js';

export interface ParseResult {
  html: string;
  toc: TocEntry[];
  langs: string[];
  hasMermaid: boolean;
  hasMath: boolean;
}

export interface TocEntry {
  level: number;
  id: string;
  text: string;
}

function slugify(s: string, used: Set<string>): string {
  const base = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'section';
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

export function buildParser(toc: TocEntry[], slugs: Set<string>): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: false,
  });

  md.use(footnote);
  md.use(tasklists, { enabled: true });
  md.use(attrs, { allowedAttributes: ['id', 'class', /^data-.*$/] });
  md.use(anchor, {
    level: [1, 2, 3, 4, 5, 6],
    slugify: (s: string) => slugify(s, slugs),
    tabIndex: false,
    permalink: anchor.permalink.headerLink({ safariReaderFix: true }),
    callback: (token: any, info: { title: string; slug: string }) => {
      toc.push({
        level: Number(token.tag.slice(1)),
        id: info.slug,
        text: info.title,
      });
    },
  });
  md.use(mathPlugin);
  md.use(alertsPlugin);

  // Deferred code highlighting — just emit language-class and raw code.
  md.options.highlight = (code, lang) => {
    const safe = md.utils.escapeHtml(code);
    const cls = lang ? ` class="language-${md.utils.escapeHtml(lang)}"` : '';
    return `<pre><code${cls}>${safe}</code></pre>`;
  };

  return md;
}

export function parse(source: string): ParseResult {
  const toc: TocEntry[] = [];
  const slugs = new Set<string>();
  const md = buildParser(toc, slugs);

  // Strip leading frontmatter: --- ... --- (YAML) or +++ ... +++ (TOML).
  const stripped = stripFrontmatter(source);

  // Pre-scan: cheap detection of language set and mermaid usage from fences.
  const fenceRe = /(^|\n) {0,3}```([A-Za-z0-9_+-]*)/g;
  const langSet = new Set<string>();
  let hasMermaid = false;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(stripped)) !== null) {
    const lang = m[2].toLowerCase();
    if (!lang) continue;
    if (lang === 'mermaid') {
      hasMermaid = true;
    } else {
      langSet.add(lang);
    }
  }

  const hasMathContent = /\$\$[\s\S]*?\$\$/.test(stripped) ||
    /(^|[^\\$])\$[^\s$][^$]*[^\s$\\]\$/.test(stripped);

  const html = md.render(stripped);

  return {
    html,
    toc,
    langs: [...langSet].slice(0, 16),
    hasMermaid,
    hasMath: hasMathContent,
  };
}

function stripFrontmatter(src: string): string {
  const yaml = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (yaml && yaml.index === 0) return src.slice(yaml[0].length);
  const toml = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?/.exec(src);
  if (toml && toml.index === 0) return src.slice(toml[0].length);
  return src;
}