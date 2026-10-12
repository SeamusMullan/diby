/**
 * Tiny, safe markdown renderer for agent-written specs. PURE (no vscode).
 * Everything is HTML-escaped first; only a fixed set of tags is ever emitted.
 * Supported: fenced code, headings, bullet/numbered lists, paragraphs, **bold**, *italic*, `code`.
 */

/** Escape text for safe inclusion in HTML text or double-quoted attributes. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(escaped: string): string {
  // Protect inline code spans from further formatting.
  const codes: string[] = [];
  let out = escaped.replace(/`([^`\n]+)`/g, (_m, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? '');
}

/** Render markdown-lite to a safe HTML fragment. */
export function renderMarkdownLite(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | undefined;

  const flushParagraph = (): void => {
    if (paragraph.length) html.push(`<p>${inline(escapeHtml(paragraph.join('\n'))).replace(/\n/g, '<br>')}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list) html.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`);
    list = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = /^\s*```/.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) code.push(lines[i++] ?? '');
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(6, (heading[1] ?? '#').length + 2); // keep h1 small inside a panel
      html.push(`<h${level}>${inline(escapeHtml(heading[2] ?? ''))}</h${level}>`);
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      const tag = /\d/.test(item[1] ?? '') ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(inline(escapeHtml(item[2] ?? '')));
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return html.join('\n');
}
