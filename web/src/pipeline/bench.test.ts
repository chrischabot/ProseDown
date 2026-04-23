import { describe, it, expect } from 'vitest';
import { parse } from './markdown.js';

/// Parse budget for a document of the given size. These are generous enough to
/// absorb CI variance (shared runners, cold JIT) while still catching any
/// regression that changes the order of magnitude of parse time.
function budgetMs(lengthBytes: number): number {
  // ~1 ms per KB with a 120 ms floor. Empirically the pipeline sits well
  // below 0.2 ms/KB on a modern laptop, so a 5x headroom is plenty.
  return Math.max(120, Math.round(lengthBytes / 1024));
}

function measure(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

/// Repeat measurement and take the best timing to reduce noise.
function bestOf(runs: number, fn: () => void): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) best = Math.min(best, measure(fn));
  return best;
}

const PROSE_PARA = 'Markview renders markdown documents beautifully and near-instantly on macOS 26. ' +
  'It combines a Rust/Tauri core with a tiny TypeScript rendering pipeline, ' +
  'Tailwind Typography prose styling, KaTeX for math, lazy Shiki for code, ' +
  'and lazy Mermaid for diagrams. The result is a viewer that feels like ' +
  'a native document app because the chrome *is* native.\n\n';

function proseDoc(kb: number): string {
  const target = kb * 1024;
  let out = '# Prose document\n\n## Intro\n\n';
  let paragraph = 0;
  while (out.length < target) {
    out += PROSE_PARA;
    paragraph++;
    if (paragraph % 7 === 0) out += '## Another section\n\n';
  }
  return out;
}

function codeHeavyDoc(): string {
  const block = '```ts\n' + [
    'import { foo, bar } from "./mod";',
    'export function hello(name: string): string {',
    '  return `Hello, ${name}!`;',
    '}',
    'const xs = [1, 2, 3].map(n => n * 2);',
    'console.log(xs);',
  ].join('\n') + '\n```\n\n';
  return '# Code-heavy\n\n' + block.repeat(40);
}

function mathHeavyDoc(): string {
  return '# Math-heavy\n\n' +
    [
      'The Pythagorean theorem: $a^2 + b^2 = c^2$.',
      'Euler: $e^{i\\pi} + 1 = 0$.',
      'Gaussian: $$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$',
      'A matrix: $$A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$',
      'Series: $\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$.',
      'Binomial: $\\binom{n}{k} = \\frac{n!}{k!(n-k)!}$.',
    ].join('\n\n').repeat(10);
}

function mermaidHeavyDoc(): string {
  const diagram = [
    '```mermaid',
    'flowchart LR',
    '  A[Finder] --> B[LaunchServices]',
    '  B --> C[Swift shell]',
    '  C --> D[WKWebView]',
    '  D --> E[Worker]',
    '  E --> F[(ready)]',
    '```',
    '',
  ].join('\n');
  return '# Mermaid-heavy\n\n' + diagram.repeat(12);
}

function tablesDoc(): string {
  const rows = Array.from({ length: 30 }, (_, i) => `| r${i} | v${i} | ${i * 7} |`).join('\n');
  const table = '| name | value | count |\n|---|---|---:|\n' + rows;
  return '# Tables\n\n' + (table + '\n\n').repeat(6);
}

function mixedRealistic(): string {
  return proseDoc(3) + '\n\n' + codeHeavyDoc() + '\n\n' + mathHeavyDoc();
}

const DOCS: Array<[string, () => string]> = [
  ['prose 1 KB',      () => proseDoc(1)],
  ['prose 10 KB',     () => proseDoc(10)],
  ['prose 50 KB',     () => proseDoc(50)],
  ['prose 200 KB',    () => proseDoc(200)],
  ['code-heavy',      codeHeavyDoc],
  ['math-heavy',      mathHeavyDoc],
  ['mermaid-heavy',   mermaidHeavyDoc],
  ['tables',          tablesDoc],
  ['mixed realistic', mixedRealistic],
  ['README-shape',    () => proseDoc(8)],
];

describe('parser performance', () => {
  // Warm up JIT on a representative doc so the first measured run isn't the
  // slowest by a factor of two.
  parse(mixedRealistic());

  for (const [name, make] of DOCS) {
    it(`${name} parses under budget`, () => {
      const src = make();
      const budget = budgetMs(src.length);
      const elapsed = bestOf(3, () => {
        const result = parse(src);
        expect(result.html.length).toBeGreaterThan(0);
      });
      if (elapsed > budget) {
        // Attach size info for easier debugging of regressions.
        throw new Error(
          `${name}: ${elapsed.toFixed(1)}ms exceeded budget ${budget}ms ` +
          `(source ${(src.length / 1024).toFixed(1)} KB)`,
        );
      }
    });
  }
});