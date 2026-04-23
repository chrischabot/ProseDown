import type MarkdownIt from 'markdown-it';

const TYPES = new Set(['note', 'tip', 'important', 'warning', 'caution']);
const ICONS: Record<string, string> = {
  note:      '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  tip:       '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 1.5a5 5 0 0 0-3 9.004V12a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.496A5 5 0 0 0 8 1.5Zm-2 12h4v.75a1.25 1.25 0 1 1-2.5 0H7.5a1.25 1.25 0 1 1-2.5 0H6Z"/></svg>',
  important: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25ZM1.75 1.5a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.189l2.72-2.719a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  warning:   '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  caution:   '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
};

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export function alertsPlugin(md: MarkdownIt): void {
  const defaultRender = md.renderer.rules.blockquote_open ?? ((tokens, idx, opts, _env, self) =>
    self.renderToken(tokens, idx, opts));

  md.core.ruler.after('block', 'github_alerts', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;
      // Find first paragraph/inline child
      let j = i + 1;
      while (j < tokens.length && tokens[j].type !== 'inline') j++;
      if (j >= tokens.length) continue;
      const inline = tokens[j];
      if (!inline.content) continue;

      const match = inline.content.match(/^\[!([A-Z]+)\]\s*\n?([\s\S]*)$/);
      if (!match) continue;
      const type = match[1].toLowerCase();
      if (!TYPES.has(type)) continue;

      const bq = tokens[i];
      bq.attrSet('class', `markview-alert`);
      bq.attrSet('data-type', type);

      // Replace first line with a title span and keep rest.
      const remainder = match[2].replace(/^\n+/, '');
      inline.content = remainder;
      if (inline.children && inline.children.length > 0) {
        // rebuild inline tokens for the remainder
        const env = {};
        const parsed = md.parseInline(remainder, env);
        if (parsed.length && parsed[0].children) {
          inline.children = parsed[0].children;
        } else {
          inline.children = [];
        }
      }

      // Insert title token at start of blockquote (as html_block).
      const title = new state.Token('html_block', '', 0);
      title.content = `<p class="markview-alert-title">${ICONS[type]}<span>${cap(type)}</span></p>\n`;
      tokens.splice(i + 1, 0, title);
    }
    return false;
  });

  md.renderer.rules.blockquote_open = defaultRender;
}