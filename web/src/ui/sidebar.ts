import type { TocEntry } from '../pipeline/markdown.js';

let sidebarEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let activeObserver: IntersectionObserver | null = null;
let visible = true;

export function mountSidebar(): HTMLElement {
  if (sidebarEl) return sidebarEl;
  const aside = document.createElement('aside');
  aside.className = 'mv-sidebar';
  aside.setAttribute('aria-label', 'Table of contents');

  const header = document.createElement('div');
  header.className = 'mv-sidebar-header';
  header.textContent = 'Contents';

  const nav = document.createElement('nav');
  nav.className = 'mv-sidebar-nav';

  const list = document.createElement('ol');
  list.className = 'mv-toc';
  list.setAttribute('role', 'listbox');
  list.setAttribute('tabindex', '-1');
  nav.appendChild(list);

  aside.append(header, nav);
  document.body.appendChild(aside);

  // Delegated keyboard navigation.
  list.addEventListener('keydown', onListKey);

  sidebarEl = aside;
  listEl = list;
  setVisible(visible);
  return aside;
}

function getFocusableLinks(): HTMLAnchorElement[] {
  if (!listEl) return [];
  return Array.from(listEl.querySelectorAll<HTMLAnchorElement>('.mv-toc-item > a'));
}

function onListKey(ev: KeyboardEvent): void {
  const links = getFocusableLinks();
  if (links.length === 0) return;

  const current = document.activeElement as HTMLElement | null;
  const currentIdx = current instanceof HTMLAnchorElement ? links.indexOf(current) : -1;

  const focusAt = (i: number) => {
    const clamped = Math.max(0, Math.min(links.length - 1, i));
    links[clamped].focus();
    // Update roving-tabindex so tab lands on the focused item next time.
    links.forEach((l, idx) => l.setAttribute('tabindex', idx === clamped ? '0' : '-1'));
  };

  switch (ev.key) {
    case 'ArrowDown':
      ev.preventDefault();
      focusAt(currentIdx === -1 ? 0 : currentIdx + 1);
      break;
    case 'ArrowUp':
      ev.preventDefault();
      focusAt(currentIdx === -1 ? 0 : currentIdx - 1);
      break;
    case 'Home':
      ev.preventDefault();
      focusAt(0);
      break;
    case 'End':
      ev.preventDefault();
      focusAt(links.length - 1);
      break;
    case 'Enter':
    case ' ':
      if (current instanceof HTMLAnchorElement) {
        ev.preventDefault();
        current.click();
      }
      break;
  }
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
    // Roving tabindex — only the first item is tab-reachable initially.
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
    // If opened with no focus inside, move focus to the active entry (or first)
    // so keyboard navigation can start immediately.
    const active = listEl?.querySelector<HTMLAnchorElement>('.mv-toc-item.is-active > a');
    const target = active ?? listEl?.querySelector<HTMLAnchorElement>('.mv-toc-item > a');
    // Only steal focus when sidebar itself is activated via keyboard (tracked below).
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