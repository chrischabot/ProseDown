const STORAGE_KEY = 'markview:scroll:v1';
const MAX_ENTRIES = 200;
const WRITE_DEBOUNCE_MS = 220;

interface ScrollMap {
  [path: string]: { y: number; at: number };
}

function readAll(): ScrollMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as ScrollMap;
  } catch {
    /* ignore */
  }
  return {};
}

function writeAll(map: ScrollMap): void {
  const entries = Object.entries(map);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => b[1].at - a[1].at);
    const trimmed: ScrollMap = {};
    for (const [k, v] of entries.slice(0, MAX_ENTRIES)) trimmed[k] = v;
    map = trimmed;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota or storage-disabled — ignore */
  }
}

let currentPath: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingY: number | null = null;
let scrollHandler: (() => void) | null = null;

function flush(): void {
  if (!currentPath || pendingY === null) return;
  const map = readAll();
  map[currentPath] = { y: pendingY, at: Date.now() };
  writeAll(map);
  pendingY = null;
}

// Register unload handlers ONCE at module load. They're no-ops when there's
// nothing to flush, so they're always safe — and registering them only once
// prevents accumulation across document switches (which invoke restoreScroll()
// repeatedly).
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
}

function attachScroll(): void {
  if (scrollHandler) return;
  scrollHandler = () => {
    pendingY = window.scrollY;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, WRITE_DEBOUNCE_MS);
  };
  window.addEventListener('scroll', scrollHandler, { passive: true });
}

function detachScroll(): void {
  if (scrollHandler) {
    window.removeEventListener('scroll', scrollHandler);
    scrollHandler = null;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  // Flush any pending write for the previous path before switching away.
  flush();
}

/// Restore any saved scroll for this path. Call after render when the DOM is
/// populated. Falls back to top-of-doc when there's no saved entry — without
/// this, switching to a freshly-opened file would inherit the previous file's
/// scroll position because the window's own scrollY is preserved across
/// innerHTML swaps.
export function restoreScroll(path: string | null): void {
  detachScroll();
  currentPath = path;
  const map = path ? readAll() : null;
  const saved = path && map ? map[path] : undefined;
  const targetY = saved && Number.isFinite(saved.y) ? saved.y : 0;
  // Defer one frame so layout (images, fonts, mermaid) has a chance to settle.
  requestAnimationFrame(() => {
    window.scrollTo({ top: targetY });
  });
  attachScroll();
}

/// Forget any stored scroll position for this path and snap to the top.
/// Used when the user clicks the already-active file in the sidebar — the
/// gesture means "take me back to the top".
export function resetScroll(path: string | null): void {
  if (path) {
    const map = readAll();
    if (path in map) {
      delete map[path];
      writeAll(map);
    }
  }
  pendingY = null;
  window.scrollTo({ top: 0 });
}