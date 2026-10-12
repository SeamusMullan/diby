import { beforeEach, describe, expect, it, vi } from 'vitest';

// Scoped settings store standing in for VS Code's configuration.
type Scope = 'global' | 'workspace' | 'workspaceFolder';
let values: Partial<Record<Scope, Record<string, unknown>>>;
let dibyDisable = true;
const TARGET = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;
const scopeOf = (t: number): Scope => (t === 1 ? 'global' : t === 2 ? 'workspace' : 'workspaceFolder');
const effective = (key: string) =>
  values.workspaceFolder?.[key] ?? values.workspace?.[key] ?? values.global?.[key];

vi.mock('vscode', () => ({
  ConfigurationTarget: TARGET,
  Uri: { parse: (s: string) => ({ s }) },
  workspace: {
    getConfiguration: (section: string) => {
      if (section === 'diby') return { get: () => dibyDisable };
      return {
        get: (key: string, def: unknown) => effective(key) ?? def,
        inspect: (key: string) => ({
          globalValue: values.global?.[key],
          workspaceValue: values.workspace?.[key],
          workspaceFolderValue: values.workspaceFolder?.[key],
        }),
        update: async (key: string, value: unknown, target: number) => {
          const scope = scopeOf(target);
          const bucket = (values[scope] ??= {});
          if (value === undefined) delete bucket[key];
          else bucket[key] = value;
        },
      };
    },
  },
}));

const { InlineSuggestGuard, winningScope } = await import('../../src/ui/inlineSuggest');

const KEY = 'inlineSuggest.enabled';
const RECORD_KEY = 'diby.inlineSuggestRestore.v1';
function memento() {
  const data = new Map<string, unknown>();
  return {
    data,
    keys: () => [...data.keys()],
    get: <T>(k: string) => data.get(k) as T | undefined,
    update: async (k: string, v: unknown) => void (v === undefined ? data.delete(k) : data.set(k, v)),
  };
}
const uri = { toString: () => 'file:///ws/a.ts' } as never;

beforeEach(() => {
  values = {};
  dibyDisable = true;
});

describe('winningScope', () => {
  it('picks the most specific scope that sets a value', () => {
    expect(winningScope(undefined)).toBe('global');
    expect(winningScope({ globalValue: true })).toBe('global');
    expect(winningScope({ globalValue: true, workspaceValue: true })).toBe('workspace');
    expect(winningScope({ workspaceValue: false, workspaceFolderValue: true })).toBe('workspaceFolder');
  });
});

describe('InlineSuggestGuard', () => {
  it('turns suggestions off globally and removes the key again when it was unset', async () => {
    const state = memento();
    const guard = new InlineSuggestGuard(state as never);
    await guard.suppress(uri);
    expect(values.global?.[KEY]).toBe(false);
    expect(state.data.get(RECORD_KEY)).toMatchObject({ scope: 'global', previous: undefined, pid: process.pid });
    await guard.restore();
    expect(values.global).toEqual({});
    expect(state.data.has(RECORD_KEY)).toBe(false);
  });

  it('writes and restores at the workspace scope when that is what decides the value', async () => {
    values = { global: { [KEY]: false }, workspace: { [KEY]: true } };
    const guard = new InlineSuggestGuard(memento() as never);
    await guard.suppress(uri);
    expect(values).toEqual({ global: { [KEY]: false }, workspace: { [KEY]: false } });
    await guard.restore();
    expect(values).toEqual({ global: { [KEY]: false }, workspace: { [KEY]: true } });
  });

  it('does nothing when suggestions are already off or the Diby setting is disabled', async () => {
    values = { global: { [KEY]: false } };
    const state = memento();
    await new InlineSuggestGuard(state as never).suppress(uri);
    expect(state.data.size).toBe(0);

    values = {};
    dibyDisable = false;
    await new InlineSuggestGuard(state as never).suppress(uri);
    expect(values).toEqual({});
  });

  it('leaves the user\'s choice alone if they re-enabled suggestions mid-challenge', async () => {
    const guard = new InlineSuggestGuard(memento() as never);
    await guard.suppress(uri);
    values.global![KEY] = true;
    await guard.restore();
    expect(values.global?.[KEY]).toBe(true);
  });

  it('only restores another window\'s change once that window is gone', async () => {
    const state = memento();
    const other = { scope: 'global', previous: true, uri: 'file:///ws/a.ts' };
    values = { global: { [KEY]: false } };

    state.data.set(RECORD_KEY, { ...other, pid: process.ppid });
    const guard = new InlineSuggestGuard(state as never);
    await guard.restore();
    await guard.recover();
    expect(values.global?.[KEY]).toBe(false);

    state.data.set(RECORD_KEY, { ...other, pid: 2 ** 22 + 12345 });
    await guard.recover();
    expect(values.global?.[KEY]).toBe(true);
    expect(state.data.has(RECORD_KEY)).toBe(false);
  });
});
