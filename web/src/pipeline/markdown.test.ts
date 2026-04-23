import { describe, it, expect } from 'vitest';
import { parse } from './markdown.js';

describe('markdown parser', () => {
  it('produces HTML for plain prose', () => {
    const r = parse('# Hello\n\nSome text.');
    expect(r.html).toContain('<h1');
    expect(r.html).toContain('Hello');
    expect(r.html).toContain('Some text.');
  });

  it('collects a ToC with slugged ids', () => {
    const r = parse('# One\n## Two\n### Three\n## Also Two');
    expect(r.toc).toHaveLength(4);
    expect(r.toc.map(e => e.id)).toEqual(['one', 'two', 'three', 'also-two']);
    expect(r.toc.map(e => e.level)).toEqual([1, 2, 3, 2]);
  });

  it('deduplicates repeated heading slugs', () => {
    const r = parse('# Intro\n## Intro\n## Intro');
    expect(r.toc.map(e => e.id)).toEqual(['intro', 'intro-2', 'intro-3']);
  });

  it('detects code-fence languages', () => {
    const src = '```ts\nconst x = 1;\n```\n```rust\nfn main() {}\n```';
    const r = parse(src);
    expect(r.langs.sort()).toEqual(['rust', 'ts']);
    expect(r.hasMermaid).toBe(false);
  });

  it('detects mermaid fences without listing them as a language', () => {
    const r = parse('```mermaid\nflowchart LR\nA-->B\n```');
    expect(r.hasMermaid).toBe(true);
    expect(r.langs).not.toContain('mermaid');
  });

  it('detects math content', () => {
    expect(parse('This is $x^2$ math.').hasMath).toBe(true);
    expect(parse('Block: $$ x = 1 $$').hasMath).toBe(true);
    expect(parse('No math here.').hasMath).toBe(false);
  });

  it('renders inline math via KaTeX', () => {
    const r = parse('Euler: $e^{i\\pi}+1=0$.');
    expect(r.html).toContain('katex');
  });

  it('strips YAML frontmatter', () => {
    const r = parse('---\ntitle: Test\n---\n# Heading\n\nBody.');
    expect(r.toc).toHaveLength(1);
    expect(r.toc[0].text).toBe('Heading');
    expect(r.html).not.toContain('title: Test');
  });

  it('strips TOML frontmatter', () => {
    const r = parse('+++\ntitle = "Test"\n+++\n# Heading');
    expect(r.toc).toHaveLength(1);
    expect(r.html).not.toContain('title = ');
  });

  it('does not strip mid-document --- separators', () => {
    const r = parse('# First\n\nPara.\n\n---\n\n## Second');
    expect(r.toc.map(e => e.id)).toEqual(['first', 'second']);
  });

  it('supports task list items', () => {
    const r = parse('- [x] done\n- [ ] todo');
    expect(r.html).toContain('task-list-item');
    expect(r.html).toContain('checked');
  });

  it('renders GFM tables', () => {
    const r = parse('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(r.html).toContain('<table>');
    expect(r.html).toContain('<th>a</th>');
  });

  it('caps lang set at 16 unique languages', () => {
    const langs = Array.from({ length: 20 }, (_, i) => `lang${i}`);
    const src = langs.map(l => '```' + l + '\nx\n```').join('\n\n');
    const r = parse(src);
    expect(r.langs.length).toBeLessThanOrEqual(16);
  });
});