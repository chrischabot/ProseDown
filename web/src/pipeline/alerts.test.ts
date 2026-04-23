import { describe, it, expect } from 'vitest';
import { parse } from './markdown.js';

describe('alerts plugin', () => {
  it('transforms [!NOTE] blockquote into a styled alert', () => {
    const r = parse('> [!NOTE]\n> This is a note.');
    expect(r.html).toContain('class="markview-alert"');
    expect(r.html).toContain('data-type="note"');
    expect(r.html).toContain('markview-alert-title');
    expect(r.html).toContain('Note');
  });

  it('recognises all five alert types', () => {
    const types = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
    for (const t of types) {
      const r = parse(`> [!${t}]\n> body`);
      expect(r.html).toContain(`data-type="${t.toLowerCase()}"`);
    }
  });

  it('leaves normal blockquotes unchanged', () => {
    const r = parse('> Just a quote.');
    expect(r.html).toContain('<blockquote>');
    expect(r.html).not.toContain('markview-alert');
  });

  it('ignores unknown alert types', () => {
    const r = parse('> [!BANANA]\n> body');
    expect(r.html).not.toContain('markview-alert');
  });

  it('renders alert body as inline content', () => {
    const r = parse('> [!TIP]\n> This is a **bold** tip.');
    expect(r.html).toContain('<strong>bold</strong>');
  });
});