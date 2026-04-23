import type { Highlighter, BundledLanguage, BundledTheme } from 'shiki';

const MAX_LANGS = 8;
const LIGHT_THEME: BundledTheme = 'github-light';
const DARK_THEME: BundledTheme = 'github-dark';

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

async function getHighlighter(langs: string[]): Promise<Highlighter> {
  const { createHighlighter } = await import('shiki');
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [LIGHT_THEME, DARK_THEME],
      langs: [],
    });
  }
  const hl = await highlighterPromise;

  const toLoad = langs
    .filter(l => !loadedLangs.has(l))
    .slice(0, MAX_LANGS - loadedLangs.size);

  for (const lang of toLoad) {
    try {
      await hl.loadLanguage(lang as BundledLanguage);
      loadedLangs.add(lang);
    } catch {
      // Unknown/unsupported language — silently ignore; fallback <pre> will remain.
    }
  }
  return hl;
}

export async function highlightAll(root: HTMLElement, langs: string[]): Promise<void> {
  if (langs.length === 0) return;

  const hl = await getHighlighter(langs);

  const blocks = root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]');
  blocks.forEach(codeEl => {
    const pre = codeEl.parentElement as HTMLPreElement;
    const lang = Array.from(codeEl.classList)
      .find(c => c.startsWith('language-'))
      ?.slice('language-'.length) ?? '';
    if (!lang || lang === 'mermaid') return;
    if (!loadedLangs.has(lang)) return;

    const code = codeEl.textContent ?? '';
    try {
      // Dual-theme output: light colors are inlined, dark colors live in
      // --shiki-dark / --shiki-dark-bg CSS vars. The stylesheet swaps them
      // under `prefers-color-scheme: dark` — no re-highlighting on theme change.
      const html = hl.codeToHtml(code, {
        lang: lang as BundledLanguage,
        themes: { light: LIGHT_THEME, dark: DARK_THEME },
      });
      // Replace the outer <pre> with shiki's output but keep scroll rules from our CSS.
      const tpl = document.createElement('template');
      tpl.innerHTML = html.trim();
      const replacement = tpl.content.firstElementChild;
      if (replacement instanceof HTMLElement) {
        replacement.classList.add('shiki-highlighted');
        pre.replaceWith(replacement);
      }
    } catch {
      // leave the plain <pre><code> in place
    }
  });
}