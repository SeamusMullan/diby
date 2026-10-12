import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMarkdownLite } from '../../src/ui/markdownLite';

describe('renderMarkdownLite', () => {
  it('escapes raw html and scripts', () => {
    const out = renderMarkdownLite('<script>alert(1)</script> & "q"');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
  it('renders inline formatting', () => {
    expect(renderMarkdownLite('a **b** *c* `d*e*`')).toBe('<p>a <strong>b</strong> <em>c</em> <code>d*e*</code></p>');
  });
  it('renders fenced code verbatim and escaped', () => {
    const out = renderMarkdownLite('```py\nx = "<a>" **no**\n```');
    expect(out).toBe('<pre><code>x = &quot;&lt;a&gt;&quot; **no**</code></pre>');
  });
  it('renders lists and headings', () => {
    const out = renderMarkdownLite('# Title\n- one\n- two\n\n1. a\n2. b');
    expect(out).toContain('<h3>Title</h3>');
    expect(out).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(out).toContain('<ol><li>a</li><li>b</li></ol>');
  });
  it('handles unterminated fences and empty input', () => {
    expect(renderMarkdownLite('```\nabc')).toContain('<pre>');
    expect(renderMarkdownLite('')).toBe('');
  });
  it('does not emit links or images', () => {
    expect(renderMarkdownLite('[x](javascript:alert(1)) ![i](http://e/x.png)')).not.toMatch(/<a |<img/);
  });
});
