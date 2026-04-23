import type { TocEntry } from './pipeline/markdown.js';

export interface DocumentPayload {
  path: string | null;
  source: string;
}

type ReloadHandler = (payload: DocumentPayload) => void;

interface TauriApi {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void>;
}

interface WebKitMessageHandler {
  postMessage(msg: unknown): void;
}
interface WebKitBridge {
  messageHandlers?: Record<string, WebKitMessageHandler | undefined>;
}
interface BridgedWindow extends Window {
  webkit?: WebKitBridge;
  __TAURI_INTERNALS__?: unknown;
}

// Cache the dynamic Tauri import: resolved exactly once per page load.
let tauriApiPromise: Promise<TauriApi | null> | null = null;

function loadTauriApi(): Promise<TauriApi | null> {
  if (tauriApiPromise) return tauriApiPromise;
  tauriApiPromise = (async () => {
    if (typeof window === 'undefined') return null;
    if (!('__TAURI_INTERNALS__' in (window as BridgedWindow))) return null;
    try {
      const [{ invoke }, { listen }] = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/event'),
      ]);
      return { invoke, listen } as TauriApi;
    } catch (err) {
      console.warn('[markview] Tauri API load failed', err);
      return null;
    }
  })();
  return tauriApiPromise;
}

function webkitHandler(): WebKitMessageHandler | null {
  const w = window as BridgedWindow;
  return w.webkit?.messageHandlers?.markview ?? null;
}

export async function loadInitialDocument(): Promise<DocumentPayload> {
  const tauri = await loadTauriApi();
  if (tauri) {
    try {
      const payload = await tauri.invoke<DocumentPayload>('load_initial_document');
      if (payload) return payload;
    } catch (err) {
      console.warn('[markview] load_initial_document failed:', err);
    }
  }

  // Browser fallback: ?file= query param or bundled sample.
  const params = new URLSearchParams(location.search);
  const fileParam = params.get('file');
  const url = fileParam ?? 'sample.md';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const source = await res.text();
    return { path: fileParam, source };
  } catch (err) {
    return {
      path: null,
      source: `# Markview\n\n_Could not load \`${url}\`: ${err instanceof Error ? err.message : String(err)}._\n\nThis is a development fallback. In production, the native shell supplies the document.`,
    };
  }
}

export async function pushToc(toc: TocEntry[]): Promise<void> {
  const tauri = await loadTauriApi();
  if (tauri) {
    try { await tauri.invoke('push_toc', { toc }); return; }
    catch (err) { console.warn('[markview] push_toc failed', err); }
  }
  webkitHandler()?.postMessage({ kind: 'toc', toc });
}

export async function pushReady(meta: { height: number; width: number }): Promise<void> {
  const tauri = await loadTauriApi();
  if (tauri) {
    try { await tauri.invoke('mark_ready', meta); return; }
    catch (err) { console.warn('[markview] mark_ready failed', err); }
  }
  webkitHandler()?.postMessage({ kind: 'ready', ...meta });
}

export async function onReload(handler: ReloadHandler): Promise<void> {
  const tauri = await loadTauriApi();
  if (tauri) {
    try {
      await tauri.listen<DocumentPayload>('markview://reload', e => handler(e.payload));
    } catch (err) {
      console.warn('[markview] failed to listen for reload events', err);
    }
  }
  // Browser / Swift-shell path: custom window event for manual reloads.
  window.addEventListener('markview-reload', e => {
    const ce = e as CustomEvent<DocumentPayload>;
    if (ce.detail) handler(ce.detail);
  });
}