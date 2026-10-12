import { describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { mergeMcpJson } from '../../src/connect/claudeCode';
import { mergeCodexToml } from '../../src/connect/codex';
import { ensureClaudeImport, upsertAgentsSection } from '../../src/connect/agentsMd';
import { buildAgentsSnippet } from '../../src/connect/snippet';
import { AGENTS_MD_END, AGENTS_MD_START } from '../../src/constants';

const SHIM = '/home/u/.diby/bin/mcp-shim.js';

describe('mergeMcpJson', () => {
  it('creates a file from nothing', () => {
    const out = mergeMcpJson(undefined, SHIM);
    expect(out.endsWith('\n')).toBe(true);
    expect(JSON.parse(out)).toEqual({ mcpServers: { diby: { command: 'node', args: [SHIM] } } });
    expect(out).toContain('\n  "mcpServers"');
  });
  it('preserves other servers and keys, and is idempotent', () => {
    const input = JSON.stringify({ foo: 1, mcpServers: { other: { command: 'x' } } });
    const once = mergeMcpJson(input, SHIM);
    expect(JSON.parse(once)).toEqual({
      foo: 1,
      mcpServers: { other: { command: 'x' }, diby: { command: 'node', args: [SHIM] } },
    });
    expect(mergeMcpJson(once, SHIM)).toBe(once);
  });
  it('updates a stale diby entry', () => {
    const out = mergeMcpJson('{"mcpServers":{"diby":{"command":"old","args":["/old"]}}}', SHIM);
    expect(JSON.parse(out).mcpServers.diby).toEqual({ command: 'node', args: [SHIM] });
  });
  it('keeps user-added keys such as env on an existing diby entry (regression)', () => {
    const input = '{"mcpServers":{"diby":{"type":"stdio","command":"old","args":["/old"],"env":{"DIBY_WORKSPACE":"/w"}}}}';
    const out = mergeMcpJson(input, SHIM);
    expect(JSON.parse(out).mcpServers.diby).toEqual({ type: 'stdio', command: 'node', args: [SHIM], env: { DIBY_WORKSPACE: '/w' } });
    expect(mergeMcpJson(out, SHIM)).toBe(out);
    const http = mergeMcpJson('{"mcpServers":{"diby":{"type":"http","url":"http://x"}}}', SHIM);
    expect(JSON.parse(http).mcpServers.diby).toEqual({ command: 'node', args: [SHIM] });
  });
  it('throws on invalid JSON or wrong shape', () => {
    expect(() => mergeMcpJson('{nope', SHIM)).toThrow(/not valid JSON/);
    expect(() => mergeMcpJson('[]', SHIM)).toThrow();
    expect(() => mergeMcpJson('{"mcpServers":[]}', SHIM)).toThrow();
  });
});

describe('mergeCodexToml', () => {
  it('creates from nothing', () => {
    const out = mergeCodexToml(undefined, SHIM);
    expect(parse(out)).toEqual({
      mcp_servers: { diby: { command: 'node', args: [SHIM], tool_timeout_sec: 60 } },
    });
  });
  it('appends and keeps comments and other content', () => {
    const input = '# my config\nmodel = "o3"\n\n[mcp_servers.other]\ncommand = "x" # keep\n';
    const out = mergeCodexToml(input, SHIM);
    expect(out.startsWith(input)).toBe(true);
    const parsed = parse(out) as any;
    expect(parsed.mcp_servers.other.command).toBe('x');
    expect(parsed.mcp_servers.diby.command).toBe('node');
  });
  it('replaces an existing table in place and is idempotent', () => {
    const input = '[a]\nx = 1\n\n[mcp_servers.diby]\ncommand = "old"\nargs = ["/old"]\n\n# note\n[b]\ny = 2\n';
    const out = mergeCodexToml(input, SHIM);
    const parsed = parse(out) as any;
    expect(parsed.mcp_servers.diby.args).toEqual([SHIM]);
    expect(parsed.a.x).toBe(1);
    expect(parsed.b.y).toBe(2);
    expect(out).toContain('# note\n[b]');
    expect(mergeCodexToml(out, SHIM)).toBe(out);
  });
  it('keeps a diby subtable such as env', () => {
    const input = '[mcp_servers.diby]\ncommand = "old"\n[mcp_servers.diby.env]\nA = "1"\n';
    const parsed = parse(mergeCodexToml(input, SHIM)) as any;
    expect(parsed.mcp_servers.diby.env).toEqual({ A: '1' });
    expect(parsed.mcp_servers.diby.command).toBe('node');
  });
  it('handles Windows paths via proper escaping', () => {
    const win = 'C:\\Users\\me\\.diby\\bin\\mcp-shim.js';
    expect((parse(mergeCodexToml(undefined, win)) as any).mcp_servers.diby.args).toEqual([win]);
  });
  it('throws on invalid TOML and on inline-table diby', () => {
    expect(() => mergeCodexToml('= broken', SHIM)).toThrow(/not valid TOML/);
    expect(() => mergeCodexToml('mcp_servers = { diby = { command = "x" } }\n', SHIM)).toThrow(/inline/);
  });
});

describe('mergeCodexToml keeps user keys (regression)', () => {
  it('keeps env / enabled / startup_timeout_sec the user added to [mcp_servers.diby]', () => {
    const input =
      'model = "o3"\n\n[mcp_servers.diby]\ncommand = "old"\nargs = ["/old"]\nenabled = false\nstartup_timeout_sec = 20\nenv = { DIBY_WORKSPACE = "/w" }\n\n[b]\ny = 2\n';
    const out = mergeCodexToml(input, SHIM);
    const diby = (parse(out) as any).mcp_servers.diby;
    expect(diby).toEqual({
      command: 'node',
      args: [SHIM],
      tool_timeout_sec: 60,
      enabled: false,
      startup_timeout_sec: 20,
      env: { DIBY_WORKSPACE: '/w' },
    });
    expect((parse(out) as any).b.y).toBe(2);
    expect(mergeCodexToml(out, SHIM)).toBe(out);
  });
  it('keeps a separately declared [mcp_servers.diby.env] sub-table', () => {
    const input = '[mcp_servers.diby]\ncommand = "old"\n\n[mcp_servers.diby.env]\nA = "1"\n';
    const out = mergeCodexToml(input, SHIM);
    expect((parse(out) as any).mcp_servers.diby.env).toEqual({ A: '1' });
  });
});

describe('upsertAgentsSection', () => {
  const snippet = buildAgentsSnippet();
  it('creates a marked section', () => {
    const out = upsertAgentsSection(undefined, snippet);
    expect(out.startsWith(AGENTS_MD_START)).toBe(true);
    expect(out.trimEnd().endsWith(AGENTS_MD_END)).toBe(true);
  });
  it('appends after existing content with a blank line, idempotently', () => {
    const once = upsertAgentsSection('# Project\n\nRules.\n', snippet);
    expect(once.startsWith('# Project\n\nRules.\n\n' + AGENTS_MD_START)).toBe(true);
    expect(upsertAgentsSection(once, snippet)).toBe(once);
  });
  it('replaces only the marked section', () => {
    const before = `intro\n\n${AGENTS_MD_START}\nold\n${AGENTS_MD_END}\n\noutro\n`;
    const out = upsertAgentsSection(before, 'new text');
    expect(out).toBe(`intro\n\n${AGENTS_MD_START}\nnew text\n${AGENTS_MD_END}\n\noutro\n`);
  });
  it('never swallows user content after a dangling start marker (regression)', () => {
    const user = `${AGENTS_MD_START}\nhalf-deleted\n\n## My rules\nkeep me\n`;
    const once = upsertAgentsSection(user, 'v1');
    const twice = upsertAgentsSection(once, 'v2');
    expect(twice).toContain('## My rules\nkeep me');
    expect(twice).toContain(`${AGENTS_MD_START}\nv2\n${AGENTS_MD_END}`);
    expect(twice).not.toContain('v1');
    expect(upsertAgentsSection(twice, 'v2')).toBe(twice);
  });
  it('is idempotent with a stray end marker before the section', () => {
    const once = upsertAgentsSection(`stray ${AGENTS_MD_END}\n`, 'v1');
    expect(upsertAgentsSection(once, 'v1')).toBe(once);
  });
});

describe('ensureClaudeImport', () => {
  it('creates, appends and is idempotent', () => {
    expect(ensureClaudeImport(undefined)).toBe('@AGENTS.md\n');
    expect(ensureClaudeImport('')).toBe('@AGENTS.md\n');
    const out = ensureClaudeImport('# Claude\nhello\n');
    expect(out).toBe('# Claude\nhello\n\n@AGENTS.md\n');
    expect(ensureClaudeImport(out)).toBe(out);
    expect(ensureClaudeImport('  @AGENTS.md  \n')).toBe('  @AGENTS.md  \n');
  });
});

describe('buildAgentsSnippet', () => {
  it('covers the key instructions and has no markers', () => {
    const s = buildAgentsSnippet();
    for (const needle of ['diby_preferences', 'diby_delegate', 'diby_wait', 'diby_cancel', 'NotImplementedError("DIBY: <symbol>")', 'verbatim', 'declined_by_policy', 'gave_up', 'testCommand']) {
      expect(s).toContain(needle);
    }
    expect(s).not.toContain('diby:start');
  });
});
