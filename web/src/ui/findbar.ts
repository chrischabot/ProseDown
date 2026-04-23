let bar: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let currentQuery = '';

interface WebkitWindow extends Window {
  find?: (
    str: string,
    caseSensitive?: boolean,
    backward?: boolean,
    wrapAround?: boolean,
    wholeWord?: boolean,
    searchInFrames?: boolean,
    showDialog?: boolean,
  ) => boolean;
}

const ICONS = {
  prev:  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M4.427 9.427a.75.75 0 0 1 0-1.06l3.396-3.396a.75.75 0 0 1 1.06 1.06L5.488 9.427a.75.75 0 0 1-1.06 0Z"/><path fill-rule="evenodd" d="M11.573 9.427a.75.75 0 0 1-1.06 0L7.117 6.031a.75.75 0 0 1 1.06-1.06l3.396 3.396a.75.75 0 0 1 0 1.06Z"/></svg>',
  next:  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M4.427 6.573a.75.75 0 0 1 1.06 0l3.396 3.396a.75.75 0 0 1-1.06 1.06L4.427 7.634a.75.75 0 0 1 0-1.06Z"/><path fill-rule="evenodd" d="M11.573 6.573a.75.75 0 0 1 0 1.06l-3.396 3.396a.75.75 0 1 1-1.06-1.06l3.396-3.396a.75.75 0 0 1 1.06 0Z"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>',
};

function button(title: string, svg: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mv-findbar-btn';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = svg;
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}

function ensureMounted(): void {
  if (bar) return;
  const el = document.createElement('div');
  el.className = 'mv-findbar';
  el.setAttribute('role', 'search');
  el.hidden = true;

  const i = document.createElement('input');
  i.type = 'search';
  i.placeholder = 'Find in document';
  i.className = 'mv-findbar-input';
  i.setAttribute('aria-label', 'Find in document');
  i.autocomplete = 'off';
  i.spellcheck = false;
  i.addEventListener('keydown', onKeyDown);
  i.addEventListener('input', onInput);

  el.append(
    i,
    button('Previous (\u21E7\u2318G)', ICONS.prev, () => findNext(true)),
    button('Next (\u2318G)', ICONS.next, () => findNext(false)),
    button('Close (Esc)', ICONS.close, hideFindBar),
  );

  document.body.appendChild(el);
  bar = el;
  input = i;
}

function onInput(): void {
  if (!input) return;
  currentQuery = input.value;
  if (!currentQuery) {
    window.getSelection()?.removeAllRanges();
    bar?.classList.remove('is-nomatch');
    return;
  }
  // Reset cursor to top of doc before searching so "find-as-you-type" feels natural.
  const sel = window.getSelection();
  sel?.removeAllRanges();
  findNext(false);
}

function onKeyDown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault();
    hideFindBar();
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    findNext(ev.shiftKey);
  } else if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'g' || ev.key === 'G')) {
    ev.preventDefault();
    findNext(ev.shiftKey);
  }
}

function findNext(backward: boolean): void {
  if (!currentQuery) return;
  const w = window as WebkitWindow;
  if (typeof w.find !== 'function') {
    // No native find support (e.g. non-WebKit runtime).
    bar?.classList.add('is-nomatch');
    return;
  }
  const found = w.find(currentQuery, false, backward, true, false, false, false);
  bar?.classList.toggle('is-nomatch', !found);
}

export function repeatFind(backward: boolean): void {
  // If we have no query yet, open the bar so the user can type one.
  if (!currentQuery) {
    showFindBar();
    return;
  }
  findNext(backward);
}

export function showFindBar(): void {
  ensureMounted();
  if (!bar || !input) return;
  bar.hidden = false;
  // Preselect any current selection for convenience
  const sel = window.getSelection()?.toString();
  if (sel && !input.value) input.value = sel;
  input.focus();
  input.select();
  currentQuery = input.value;
  if (currentQuery) findNext(false);
}

export function hideFindBar(): void {
  if (!bar) return;
  bar.hidden = true;
  window.getSelection()?.removeAllRanges();
  bar.classList.remove('is-nomatch');
  // Return focus to the document body.
  (document.getElementById('doc') ?? document.body).focus();
}

export function isFindBarOpen(): boolean {
  return !!bar && !bar.hidden;
}