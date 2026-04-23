let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

const MAX_DIAGRAM_BYTES = 128 * 1024; // 128 KiB per diagram is already huge

async function getMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(mod => {
      const m = mod.default;
      const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
      m.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'strict',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
      });
      return m;
    });
  }
  return mermaidPromise;
}

let counter = 0;

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function renderErrorBox(msg: string): string {
  return `<div class="markview-render-error"><strong>Diagram error:</strong> ${escapeText(msg)}</div>`;
}

async function renderOne(codeEl: HTMLElement): Promise<void> {
  const pre = codeEl.closest('pre');
  if (!pre) return;
  const source = codeEl.textContent ?? '';
  const trimmed = source.trim();
  if (!trimmed) return;

  if (trimmed.length > MAX_DIAGRAM_BYTES) {
    console.warn(`[markview] mermaid diagram too large (${trimmed.length} bytes); skipping`);
    const container = document.createElement('div');
    container.className = 'markview-mermaid';
    container.innerHTML = renderErrorBox(
      `Diagram source exceeds ${MAX_DIAGRAM_BYTES} byte safety cap (${trimmed.length} bytes).`,
    );
    pre.replaceWith(container);
    return;
  }

  const id = `mv-mermaid-${++counter}`;
  const container = document.createElement('div');
  container.className = 'markview-mermaid';
  container.setAttribute('data-mermaid-id', id);

  try {
    const mermaid = await getMermaid();
    const { svg } = await mermaid.render(id, source);
    container.innerHTML = svg;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[markview] mermaid render failed (${id})`, err);
    container.innerHTML = renderErrorBox(msg);
  }
  pre.replaceWith(container);
}

export function scheduleMermaid(root: HTMLElement): void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre > code.language-mermaid'));
  if (blocks.length === 0) return;

  if (!('IntersectionObserver' in window)) {
    blocks.forEach(el => void renderOne(el));
    return;
  }

  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      void renderOne(entry.target as HTMLElement);
    });
  }, { rootMargin: '200px 0px' });

  blocks.forEach(el => io.observe(el));
}