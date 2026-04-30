import type { TocEntry } from '../pipeline/markdown.js';
import type { DocumentSummary } from '../bridge.js';

type Tab = 'outline' | 'files';

let sidebarEl: HTMLElement | null = null;
let outlinePanel: HTMLElement | null = null;
let filesPanel: HTMLElement | null = null;
let listEl: HTMLElement | null = null; // outline (ToC) list
let filesListEl: HTMLElement | null = null; // file list
let outlineTabBtn: HTMLButtonElement | null = null;
let filesTabBtn: HTMLButtonElement | null = null;
let activeObserver: IntersectionObserver | null = null;
let visible = true;
let tab: Tab = 'outline';

/** Caller-supplied — invoked when the user clicks a file row. */
let onFileSelect: ((index: number) => void) | null = null;

export function setOnFileSelect(handler: (index: number) => void): void {
  onFileSelect = handler;
}

export function mountSidebar(): HTMLElement {
  if (sidebarEl) return sidebarEl;
  const aside = document.createElement('aside');
  aside.className = 'mv-sidebar';
  aside.setAttribute('aria-label', 'Sidebar');

  // Header — segmented control to switch tab.
  const header = document.createElement('div');
  header.className = 'mv-sidebar-header';

  const seg = document.createElement('div');
  seg.className = 'mv-segctl';
  seg.setAttribute('role', 'tablist');

  outlineTabBtn = makeTabButton('Outline', 'outline');
  filesTabBtn = makeTabButton('Files', 'files');
  seg.append(outlineTabBtn, filesTabBtn);
  header.appendChild(seg);

  // Body — two panels, only the active one visible.
  const nav = document.createElement('nav');
  nav.className = 'mv-sidebar-nav';

  outlinePanel = document.createElement('div');
  outlinePanel.className = 'mv-panel mv-panel-outline';
  outlinePanel.setAttribute('role', 'tabpanel');
  const list = document.createElement('ol');
  list.className = 'mv-toc';
  list.setAttribute('role', 'listbox');
  list.setAttribute('tabindex', '-1');
  list.addEventListener('keydown', onListKey);
  outlinePanel.appendChild(list);
  listEl = list;

  filesPanel = document.createElement('div');
  filesPanel.className = 'mv-panel mv-panel-files';
  filesPanel.hidden = true;
  filesPanel.setAttribute('role', 'tabpanel');
  const filesList = document.createElement('ul');
  filesList.className = 'mv-files';
  filesList.setAttribute('role', 'listbox');
  filesList.setAttribute('tabindex', '-1');
  filesList.addEventListener('keydown', onFilesKey);
  filesPanel.appendChild(filesList);
  filesListEl = filesList;

  nav.append(outlinePanel, filesPanel);

  aside.append(header, nav);
  document.body.appendChild(aside);

  sidebarEl = aside;
  setVisible(visible);
  return aside;
}

function makeTabButton(label: string, t: Tab): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mv-segbtn';
  btn.dataset.tab = t;
  btn.textContent = label;
  btn.setAttribute('role', 'tab');
  btn.addEventListener('click', () => setTab(t));
  return btn;
}

export function setTab(next: Tab): void {
  tab = next;
  if (!sidebarEl) mountSidebar();
  outlinePanel!.hidden = tab !== 'outline';
  filesPanel!.hidden = tab !== 'files';
  outlineTabBtn?.classList.toggle('is-active', tab === 'outline');
  filesTabBtn?.classList.toggle('is-active', tab === 'files');
  outlineTabBtn?.setAttribute('aria-selected', String(tab === 'outline'));
  filesTabBtn?.setAttribute('aria-selected', String(tab === 'files'));
}

function getOutlineLinks(): HTMLAnchorElement[] {
  if (!listEl) return [];
  return Array.from(listEl.querySelectorAll<HTMLAnchorElement>('.mv-toc-item > a'));
}

function getFileButtons(): HTMLButtonElement[] {
  if (!filesListEl) return [];
  return Array.from(filesListEl.querySelectorAll<HTMLButtonElement>('.mv-file-item > button'));
}

function rovingFocusKey(items: HTMLElement[], ev: KeyboardEvent): void {
  if (items.length === 0) return;
  const current = document.activeElement as HTMLElement | null;
  const currentIdx = current ? items.indexOf(current) : -1;
  const focusAt = (i: number) => {
    const clamped = Math.max(0, Math.min(items.length - 1, i));
    items[clamped].focus();
    items.forEach((el, idx) => el.setAttribute('tabindex', idx === clamped ? '0' : '-1'));
  };
  switch (ev.key) {
    case 'ArrowDown': ev.preventDefault(); focusAt(currentIdx === -1 ? 0 : currentIdx + 1); break;
    case 'ArrowUp':   ev.preventDefault(); focusAt(currentIdx === -1 ? 0 : currentIdx - 1); break;
    case 'Home':      ev.preventDefault(); focusAt(0); break;
    case 'End':       ev.preventDefault(); focusAt(items.length - 1); break;
    case 'Enter':
    case ' ':
      if (current) { ev.preventDefault(); current.click(); }
      break;
  }
}

function onListKey(ev: KeyboardEvent): void {
  rovingFocusKey(getOutlineLinks(), ev);
}
function onFilesKey(ev: KeyboardEvent): void {
  rovingFocusKey(getFileButtons(), ev);
}

export function setToc(entries: TocEntry[]): void {
  if (!listEl) mountSidebar();
  if (!listEl) return;

  listEl.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'mv-toc-empty';
    empty.textContent = 'No headings';
    listEl.appendChild(empty);
    if (activeObserver) { activeObserver.disconnect(); activeObserver = null; }
    return;
  }

  const minLevel = entries.reduce((m, e) => Math.min(m, e.level), 6);

  entries.forEach((e, idx) => {
    const li = document.createElement('li');
    li.className = `mv-toc-item mv-toc-lv-${e.level - minLevel + 1}`;
    li.dataset.id = e.id;
    li.setAttribute('role', 'option');

    const a = document.createElement('a');
    a.href = `#${encodeURIComponent(e.id)}`;
    a.textContent = e.text;
    a.tabIndex = idx === 0 ? 0 : -1;
    a.addEventListener('click', ev => {
      ev.preventDefault();
      const target = document.getElementById(e.id);
      if (target) {
        history.replaceState(null, '', `#${e.id}`);
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.focus({ preventScroll: true });
      }
    });

    li.appendChild(a);
    listEl!.appendChild(li);
  });

  watchActive(entries);
}

export function setDocuments(docs: DocumentSummary[], selectedIndex: number | null): void {
  if (!filesListEl) mountSidebar();
  if (!filesListEl) return;

  // Hide the Files tab button entirely when there's nothing to navigate.
  if (filesTabBtn) filesTabBtn.hidden = docs.length === 0;

  filesListEl.innerHTML = '';
  if (docs.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'mv-files-empty';
    empty.textContent = 'No documents open';
    filesListEl.appendChild(empty);
    return;
  }

  docs.forEach((doc, idx) => {
    const li = document.createElement('li');
    li.className = 'mv-file-item';
    if (idx === selectedIndex) li.classList.add('is-active');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mv-file-btn';
    btn.tabIndex = idx === 0 ? 0 : -1;
    btn.title = doc.path;
    btn.setAttribute('aria-selected', String(idx === selectedIndex));

    const name = document.createElement('span');
    name.className = 'mv-file-name';
    name.textContent = doc.name;
    btn.appendChild(name);

    if (doc.path !== doc.name) {
      const sub = document.createElement('span');
      sub.className = 'mv-file-subpath';
      sub.textContent = parentDisplay(doc.path);
      btn.appendChild(sub);
    }

    btn.addEventListener('click', () => {
      if (onFileSelect) onFileSelect(idx);
    });

    li.appendChild(btn);
    filesListEl!.appendChild(li);
  });
}

function parentDisplay(fullPath: string): string {
  const parts = fullPath.split('/');
  parts.pop();
  if (parts.length === 0) return '';
  // Show last 2 segments of the parent path so users can disambiguate
  // multiple files with the same name.
  const tail = parts.slice(-2).filter(Boolean).join('/');
  return tail ? `…/${tail}` : '/';
}

function watchActive(entries: TocEntry[]): void {
  if (activeObserver) activeObserver.disconnect();
  const map = new Map<Element, string>();
  for (const e of entries) {
    const el = document.getElementById(e.id);
    if (el) map.set(el, e.id);
  }
  if (map.size === 0) return;

  activeObserver = new IntersectionObserver(obsEntries => {
    let best: { id: string; top: number } | null = null;
    for (const entry of obsEntries) {
      if (!entry.isIntersecting) continue;
      const id = map.get(entry.target);
      if (!id) continue;
      const top = entry.boundingClientRect.top;
      if (!best || top < best.top) best = { id, top };
    }
    if (best) setActive(best.id);
  }, {
    rootMargin: '0px 0px -70% 0px',
    threshold: [0, 0.25, 0.5, 0.75, 1],
  });

  for (const el of map.keys()) activeObserver.observe(el);
}

function setActive(id: string): void {
  if (!listEl) return;
  listEl.querySelectorAll<HTMLElement>('.mv-toc-item').forEach(item => {
    item.classList.toggle('is-active', item.dataset.id === id);
  });
}

export function toggleSidebar(): void {
  setVisible(!visible);
}

export function setVisible(v: boolean): void {
  visible = v;
  if (!sidebarEl) mountSidebar();
  if (!sidebarEl) return;
  sidebarEl.classList.toggle('is-hidden', !visible);
  document.body.classList.toggle('mv-sidebar-open', visible);
  sidebarEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (visible) {
    const active = listEl?.querySelector<HTMLAnchorElement>('.mv-toc-item.is-active > a');
    const target = active ?? listEl?.querySelector<HTMLAnchorElement>('.mv-toc-item > a');
    if (target && sidebarEl.dataset.openedByKeyboard === '1') {
      queueMicrotask(() => target.focus());
      delete sidebarEl.dataset.openedByKeyboard;
    }
  }
}

export function markOpenedByKeyboard(): void {
  if (sidebarEl) sidebarEl.dataset.openedByKeyboard = '1';
}

export function isVisible(): boolean {
  return visible;
}
