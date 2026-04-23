interface ToolbarHandlers {
  toggleSidebar: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  print: () => void;
}

const ICONS = {
  sidebar: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1ZM1.5 2.75v10.5c0 .138.112.25.25.25H5v-11H1.75a.25.25 0 0 0-.25.25Zm5 10.75h7.75a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H6.5v11Z"/></svg>',
  zoomIn:  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 4a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 8 4Z"/><path fill-rule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z"/></svg>',
  zoomOut: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M4.75 7.25h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Z"/><path fill-rule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z"/></svg>',
  reset:   '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 2.75a5.25 5.25 0 1 0 5.073 6.533.75.75 0 0 1 1.454.367A6.75 6.75 0 1 1 8 1.25a6.72 6.72 0 0 1 4.5 1.727V1.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h1.678A5.23 5.23 0 0 0 8 2.75Z"/></svg>',
  print:   '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M5 1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75V3h1.25c1.519 0 2.75 1.231 2.75 2.75v3.5A1.75 1.75 0 0 1 13.25 11H11v3.25A1.75 1.75 0 0 1 9.25 16h-2.5A1.75 1.75 0 0 1 5 14.25V11H2.75A1.75 1.75 0 0 1 1 9.25v-3.5A2.75 2.75 0 0 1 3.75 3H5V1.75Zm4.5 0a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25V3h3V1.75Zm-5.75 2.75a1.25 1.25 0 0 0-1.25 1.25v3.5c0 .138.112.25.25.25H5V7.75C5 7.336 5.336 7 5.75 7h4.5c.414 0 .75.336.75.75v1.75h2.25a.25.25 0 0 0 .25-.25v-3.5a1.25 1.25 0 0 0-1.25-1.25h-8.5ZM6.5 14.25c0 .138.112.25.25.25h2.5a.25.25 0 0 0 .25-.25V8.5h-3v5.75Z"/></svg>',
};

function iconButton(id: string, title: string, shortcut: string, svg: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = 'mv-btn';
  btn.title = `${title} (${shortcut})`;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = svg;
  btn.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return btn;
}

function divider(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'mv-divider';
  return el;
}

export function mountToolbar(handlers: ToolbarHandlers): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'mv-toolbar';
  bar.setAttribute('role', 'toolbar');

  bar.append(
    iconButton('mv-btn-sidebar', 'Toggle sidebar', '⌘\\', ICONS.sidebar, handlers.toggleSidebar),
    divider(),
    iconButton('mv-btn-zoom-out', 'Zoom out', '⌘-', ICONS.zoomOut, handlers.zoomOut),
    iconButton('mv-btn-zoom-reset', 'Actual size', '⌘0', ICONS.reset, handlers.zoomReset),
    iconButton('mv-btn-zoom-in', 'Zoom in', '⌘+', ICONS.zoomIn, handlers.zoomIn),
    divider(),
    iconButton('mv-btn-print', 'Print', '⌘P', ICONS.print, handlers.print),
  );

  document.body.appendChild(bar);
  return bar;
}