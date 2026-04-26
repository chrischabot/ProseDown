import DOMPurify from 'dompurify';
import { loadInitialDocument, onReload, pushReady, pushToc, setActiveDocument, type DocumentPayload } from './bridge.js';
import type { WorkerRequest, WorkerResponse } from './worker.js';
import type { ParseResult } from './pipeline/markdown.js';
import { mountToolbar } from './ui/toolbar.js';
import {
  mountSidebar,
  setToc,
  setDocuments,
  setOnFileSelect,
  toggleSidebar as toggleSidebarDom,
  setVisible as setSidebarVisible,
  markOpenedByKeyboard,
} from './ui/sidebar.js';
import { showFindBar, hideFindBar, isFindBarOpen, repeatFind } from './ui/findbar.js';
import { flagBrokenAnchors } from './ui/linkcheck.js';
import { restoreScroll } from './ui/scrollmemory.js';

const docEl = document.getElementById('doc') as HTMLElement;
const loadingEl = document.getElementById('markview-loading');

// Upper bound for a single parse. Beyond this the UI would feel stuck anyway;
// better to surface an error than keep the user staring at a spinner.
const PARSE_TIMEOUT_MS = 10_000;

interface PendingEntry {
  resolve: (r: ParseResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let reqId = 0;
const pending = new Map<number, PendingEntry>();
let worker: Worker = createWorker();

function createWorker(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
    const entry = pending.get(e.data.id);
    if (!entry) return;
    pending.delete(e.data.id);
    clearTimeout(entry.timer);
    if (e.data.ok && e.data.result) entry.resolve(e.data.result);
    else entry.reject(new Error(e.data.error ?? 'worker parse failed'));
  });
  w.addEventListener('error', err => {
    console.error('[markview] worker crashed, recreating', err);
    const stale = [...pending.values()];
    pending.clear();
    for (const entry of stale) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`worker crashed: ${err.message ?? 'unknown'}`));
    }
    try { w.terminate(); } catch { /* already gone */ }
    // Replace the module-level worker so the next parse call uses the fresh one.
    worker = createWorker();
  });
  return w;
}

function parseInWorker(source: string): Promise<ParseResult> {
  return new Promise<ParseResult>((resolve, reject) => {
    const id = ++reqId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(
        `parse timeout (>${PARSE_TIMEOUT_MS}ms) — source is ${source.length} bytes`,
      ));
    }, PARSE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    const msg: WorkerRequest = { id, source };
    worker.postMessage(msg);
  });
}

let katexCssLoaded = false;
async function ensureKatexCss(): Promise<void> {
  if (katexCssLoaded) return;
  katexCssLoaded = true;
  try {
    await import('katex/dist/katex.min.css');
  } catch (err) {
    katexCssLoaded = false;
    console.warn('[markview] failed to load KaTeX CSS', err);
  }
}

// DOMPurify configuration — built-in HTML + SVG + MathML profiles preserve
// KaTeX output correctly. We only strip tags/attributes that can execute code
// or navigate the top-level browsing context.
const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'meta', 'form', 'input', 'button'],
  FORBID_ATTR: [
    'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseenter', 'onmouseleave',
    'onfocus', 'onblur', 'onchange', 'onsubmit', 'onreset', 'onkeydown', 'onkeyup', 'onkeypress',
    'ontouchstart', 'ontouchend', 'onwheel', 'oncontextmenu',
    'formaction', 'action',
  ],
  ALLOW_DATA_ATTR: true,
  KEEP_CONTENT: true,
} as const satisfies Parameters<typeof DOMPurify.sanitize>[1];

function purify(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;
}

// Monotonic render counter — guards against stale parses from prior render()
// calls overwriting a newer one when live-reload fires rapidly.
let latestRenderId = 0;

async function render(payload: DocumentPayload, preserveScroll = false): Promise<void> {
  const myId = ++latestRenderId;
  const t0 = performance.now();
  const prevScroll = preserveScroll ? window.scrollY : 0;

  let result: ParseResult;
  try {
    result = await parseInWorker(payload.source);
  } catch (err) {
    if (myId !== latestRenderId) return; // a newer render already superseded us
    console.error('[markview] parse failed', err);
    docEl.innerHTML = `<div class="markview-render-error"><strong>Parse failed:</strong> ${escapeHtml(String(err instanceof Error ? err.message : err))}</div>`;
    loadingEl?.remove();
    return;
  }

  // Discard stale results — a newer render() call took precedence.
  if (myId !== latestRenderId) return;

  if (result.hasMath) await ensureKatexCss();

  const safe = purify(result.html);
  docEl.innerHTML = safe;
  docEl.classList.remove('is-ready');
  void docEl.offsetWidth;
  docEl.classList.add('is-ready');

  loadingEl?.remove();

  setToc(result.toc);
  void pushToc(result.toc);
  setDocuments(payload.documents ?? [], payload.selected_index ?? null);

  const metrics = { height: docEl.scrollHeight, width: docEl.scrollWidth };
  void pushReady(metrics);

  const firstH1 = docEl.querySelector('h1');
  if (firstH1) document.title = `${firstH1.textContent ?? 'Markview'} — Markview`;
  else if (payload.path) {
    const name = payload.path.split('/').pop() ?? 'Markview';
    document.title = `${name} — Markview`;
  }

  if (location.hash) {
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    el?.scrollIntoView();
  } else if (preserveScroll) {
    window.scrollTo({ top: prevScroll });
  } else {
    restoreScroll(payload.path);
  }

  interceptLinks();
  flagBrokenAnchors(docEl);

  if (result.langs.length > 0) {
    void import('./pipeline/shiki.js')
      .then(m => m.highlightAll(docEl, result.langs))
      .catch(err => console.warn('[markview] shiki failed', err));
  }
  if (result.hasMermaid) {
    void import('./pipeline/mermaid.js')
      .then(m => m.scheduleMermaid(docEl))
      .catch(err => console.warn('[markview] mermaid load failed', err));
  }

  const dt = Math.round(performance.now() - t0);
  console.info(`[markview] rendered in ${dt}ms — ${payload.path ?? '(no path)'}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' : '&#39;'
  ));
}

function interceptLinks(): void {
  docEl.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      a.addEventListener('click', ev => {
        ev.preventDefault();
        const id = decodeURIComponent(href.slice(1));
        const target = document.getElementById(id);
        if (target) {
          history.replaceState(null, '', `#${id}`);
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    } else if (/^https?:/i.test(href) || /^mailto:/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer noopener');
    }
  });
}

function setZoom(z: number): void {
  const clamped = Math.max(0.6, Math.min(2.0, z));
  docEl.style.setProperty('--markview-zoom', String(clamped));
}
function currentZoom(): number {
  return Number(getComputedStyle(docEl).getPropertyValue('--markview-zoom')) || 1;
}

const NARROW_PX = 720;
let sidebarUserPref = false;

function applySidebarForViewport(): void {
  const narrow = window.innerWidth < NARROW_PX;
  setSidebarVisible(sidebarUserPref && !narrow);
}

function userToggleSidebar(fromKeyboard: boolean): void {
  const narrow = window.innerWidth < NARROW_PX;
  if (narrow) {
    if (fromKeyboard) markOpenedByKeyboard();
    toggleSidebarDom();
    return;
  }
  sidebarUserPref = !sidebarUserPref;
  if (sidebarUserPref && fromKeyboard) markOpenedByKeyboard();
  setSidebarVisible(sidebarUserPref);
}

function wireKeyboard(): void {
  window.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && isFindBarOpen()) {
      ev.preventDefault();
      hideFindBar();
      return;
    }
    if (!(ev.metaKey || ev.ctrlKey)) return;
    switch (ev.key) {
      case '=':
      case '+': setZoom(currentZoom() + 0.1); ev.preventDefault(); break;
      case '-': setZoom(currentZoom() - 0.1); ev.preventDefault(); break;
      case '0': setZoom(1); ev.preventDefault(); break;
      case '\\': userToggleSidebar(true); ev.preventDefault(); break;
      case 'p': window.print(); ev.preventDefault(); break;
      case 'f': showFindBar(); ev.preventDefault(); break;
      case 'g':
      case 'G':
        repeatFind(ev.shiftKey);
        ev.preventDefault();
        break;
    }
  });
}

function wireChrome(): void {
  mountSidebar();
  applySidebarForViewport();

  setOnFileSelect(index => {
    void setActiveDocument(index).then(payload => {
      if (payload) void render(payload);
    });
  });

  mountToolbar({
    toggleSidebar: () => userToggleSidebar(false),
    zoomIn: () => setZoom(currentZoom() + 0.1),
    zoomOut: () => setZoom(currentZoom() - 0.1),
    zoomReset: () => setZoom(1),
    print: () => window.print(),
  });

  let wasNarrow = window.innerWidth < NARROW_PX;
  window.addEventListener('resize', () => {
    const narrow = window.innerWidth < NARROW_PX;
    if (narrow !== wasNarrow) {
      wasNarrow = narrow;
      applySidebarForViewport();
    }
  });
}

async function boot(): Promise<void> {
  wireChrome();
  wireKeyboard();
  void onReload(p => { void render(p, true); });
  try {
    const payload = await loadInitialDocument();
    await render(payload);
  } catch (err) {
    console.error('[markview] boot failed', err);
    docEl.innerHTML = `<div class="markview-render-error"><strong>Failed to start:</strong> ${escapeHtml(String(err instanceof Error ? err.message : err))}</div>`;
  }
}

boot().catch(err => {
  console.error('[markview] boot threw after recovery', err);
});