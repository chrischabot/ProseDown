import { describe, it, expect } from 'vitest';
import { parse } from './markdown.js';

describe('math plugin', () => {
  it('renders inline $…$ via KaTeX', () => {
    const r = parse('Pythagoras: $a^2 + b^2 = c^2$.');
    expect(r.html).toContain('class="katex"');
  });

  it('renders block $$…$$ via KaTeX display mode', () => {
    const r = parse('$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$');
    expect(r.html).toContain('katex-block');
    expect(r.html).toContain('katex-display');
  });

  it('does not trigger on currency like "$5 and $10"', () => {
    const r = parse('Pay $5 and $10 please.');
    expect(r.html).not.toContain('class="katex"');
  });

  it('renders a malformed math expression without throwing', () => {
    expect(() => parse('Broken: $\\frac{1}{}$')).not.toThrow();
  });

  it('handles escaped dollar signs', () => {
    const r = parse('Literal \\$5 and real $x^2$ math.');
    expect(r.html).toContain('class="katex"');
  });

  it('handles single-line $$ block', () => {
    const r = parse('$$ x = 1 $$');
    expect(r.html).toContain('katex-block');
  });
});