import { describe, expect, it, vi } from 'vitest';
import { ChallengeManager } from '../../src/core/ChallengeManager';
import { InMemoryHistoryStore } from '../../src/core/history';
import { decide } from '../../src/core/policy';
import type {
  Challenge,
  ChallengeManagerDeps,
  ChallengeUi,
  DelegateRequest,
  DibySettings,
  LanguageAdapter,
  OfferAnswer,
  PolicyFn,
  TestRunResult,
} from '../../src/types';

const WS = '/ws';
const req = (over: Partial<DelegateRequest> = {}): DelegateRequest => ({
  file: 'src/a.py',
  range: { startLine: 3, endLine: 6 },
  symbol: 'parse',
  signature: 'def parse(x):',
  spec: 'spec',
  testCommand: 'pytest -q',
  testFiles: ['tests/test_a.py'],
  language: 'python',
  concepts: ['parsing'],
  difficulty: 3,
  ...over,
});
const run = (ok: boolean): TestRunResult => ({
  ok, command: 'pytest', exitCode: ok ? 0 : 1, timedOut: false, startedAt: 0, durationMs: 5, cases: [],
  passed: ok ? 4 : 2, failed: ok ? 0 : 2, errors: 0, skipped: 0, total: 4, stdout: '', stderr: '', diagnostics: [],
});

function setup(opts: {
  answer?: OfferAnswer | Promise<OfferAnswer>;
  results?: TestRunResult[];
  settings?: Partial<DibySettings>;
  policy?: PolicyFn;
  stubOk?: boolean;
  confirm?: boolean;
  reflection?: string;
  locate?: LanguageAdapter['locateSymbol'];
  history?: InMemoryHistoryStore;
  readText?: () => Promise<string>;
} = {}) {
  let t = 1_000_000;
  const settings: DibySettings = {
    mode: 'learn', focusConcepts: [], avoidConcepts: [], maxDifficulty: 5, testTimeoutSec: 60, askForReflection: true,
    ...opts.settings,
  };
  const ui = {
    offer: vi.fn(async () => (await opts.answer) ?? 'accept'),
    show: vi.fn(async () => {}),
    refresh: vi.fn(),
    clear: vi.fn(),
    reveal: vi.fn(async () => {}),
    captureCode: vi.fn(async () => ({ code: 'def parse(x):\n    return 1\n', range: { startLine: 3, endLine: 4 } })),
    saveFile: vi.fn(async () => {}),
    askReflection: vi.fn(async () => opts.reflection),
    confirmGiveUp: vi.fn(async () => opts.confirm ?? true),
    notify: vi.fn(),
  } satisfies ChallengeUi;
  const adapter: LanguageAdapter = {
    id: 'python', displayName: 'Python', aliases: [],
    validateStub: () => (opts.stubOk === false ? { ok: false, problems: ['no marker'] } : { ok: true, problems: [] }),
    instrumentTestCommand: (cmd) => ({ cmd }),
    parseResults: () => run(true),
    ...(opts.locate ? { locateSymbol: opts.locate } : {}),
  };
  const results = [...(opts.results ?? [run(true)])];
  const runTests = vi.fn(async () => results.shift() ?? run(true));
  const history = opts.history ?? new InMemoryHistoryStore();
  let n = 0;
  const deps: ChallengeManagerDeps = {
    ui,
    workspace: {
      resolve: (f) => (f.includes('missing') ? undefined : { absPath: `${WS}/${f}`, workspaceFolder: WS }),
      readText: opts.readText ?? (async () => 'text'),
    },
    history,
    languages: { get: () => adapter, has: () => true, list: () => [adapter] },
    runTests,
    decide: opts.policy ?? decide,
    getSettings: () => settings,
    log: () => {},
    now: () => (t += 1000),
    newId: () => `id${++n}`,
  };
  const mgr = new ChallengeManager(deps);
  return { mgr, ui, runTests, history, settings, advance: (ms: number) => (t += ms) };
}

const ctx = {};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('delegate', () => {
  it('returns pending immediately and becomes active once accepted', async () => {
    const { mgr, ui, history } = setup();
    const res = await mgr.delegate(req(), ctx);
    expect(res).toMatchObject({ id: 'id1', status: 'pending' });
    await flush();
    expect(mgr.get('id1')?.status).toBe('active');
    expect(ui.show).toHaveBeenCalledOnce();
    expect(history.all()[0]).toMatchObject({ id: 'id1', offered: true, status: 'active' });
  });

  it('declines when snoozed, busy, file missing, stub invalid, or policy says no', async () => {
    const a = setup();
    a.mgr.snooze();
    expect((await a.mgr.delegate(req(), ctx)).status).toBe('declined_by_policy');

    const b = setup({ answer: new Promise<OfferAnswer>(() => {}) });
    await b.mgr.delegate(req(), ctx);
    const busy = await b.mgr.delegate(req(), ctx);
    expect(busy.status).toBe('declined_by_policy');
    expect(busy.message).toContain('busy');

    const c = setup();
    expect((await c.mgr.delegate(req({ file: 'missing.py' }), ctx)).message).toContain('file not found');

    const d = setup({ stubOk: false });
    expect((await d.mgr.delegate(req(), ctx)).message).toContain('no marker');

    const e = setup({ settings: { mode: 'off' } });
    const res = await e.mgr.delegate(req(), ctx);
    expect(res.status).toBe('declined_by_policy');
    expect(e.history.all()[0]).toMatchObject({ offered: false, status: 'declined_by_policy' });
    expect(e.ui.offer).not.toHaveBeenCalled();
  });

  it('skip and snooze answers decline the challenge', async () => {
    const s = setup({ answer: 'skip' });
    const { id } = await s.mgr.delegate(req(), ctx);
    await flush();
    expect(s.mgr.get(id)?.status).toBe('declined');
    expect(s.mgr.snoozed).toBe(false);
    expect(s.history.all()[0]?.status).toBe('declined');

    const z = setup({ answer: 'snooze' });
    const r = await z.mgr.delegate(req(), ctx);
    await flush();
    expect(z.mgr.get(r.id)?.status).toBe('declined');
    expect(z.mgr.snoozed).toBe(true);
    expect((await z.mgr.delegate(req(), ctx)).status).toBe('declined_by_policy');
  });

  it('applies rate limiting across calls', async () => {
    const s = setup({ settings: { mode: 'steady' }, answer: 'skip' });
    await s.mgr.delegate(req(), ctx);
    await flush();
    const second = await s.mgr.delegate(req(), ctx);
    expect(second.status).toBe('declined_by_policy');
    expect(second.message).toContain('rate limit');
  });

  it('resolves test files and cwd', async () => {
    const s = setup();
    const { id } = await s.mgr.delegate(req({ cwd: 'sub' }), { cwd: '/ws/proj' });
    const c = s.mgr.get(id)!;
    expect(c.testFiles).toEqual(['/ws/tests/test_a.py']);
    expect(c.testCwd).toBe('/ws/proj/sub');
    const s2 = setup();
    const r2 = await s2.mgr.delegate(req(), { cwd: '/elsewhere' });
    expect(s2.mgr.get(r2.id)?.testCwd).toBe(WS);
    const s3 = setup();
    const r3 = await s3.mgr.delegate(req(), { cwd: '/ws/proj' });
    expect(s3.mgr.get(r3.id)?.testCwd).toBe('/ws/proj');
  });
});

describe('delegate regressions', () => {
  it('re-locates the function on accept when the file changed while the offer was open', async () => {
    let answer!: (a: OfferAnswer) => void;
    const locate = vi.fn(() => ({ startLine: 13, endLine: 16 }));
    const { mgr, ui } = setup({ answer: new Promise<OfferAnswer>((r) => (answer = r)), locate });
    const { id } = await mgr.delegate(req(), ctx);
    expect(mgr.get(id)?.range).toEqual({ startLine: 3, endLine: 6 });
    answer('accept'); // meanwhile the agent added 10 lines of imports above the stub
    await flush();
    expect(locate).toHaveBeenCalledWith('text', 'parse', { startLine: 3, endLine: 6 });
    expect(mgr.get(id)?.status).toBe('active');
    expect(mgr.get(id)?.range).toEqual({ startLine: 13, endLine: 16 });
    expect((ui.show.mock.calls[0] as unknown as [Challenge])[0].range).toEqual({ startLine: 13, endLine: 16 });
  });

  it('a delegate that loses the busy race does not leave a pending, offered history entry', async () => {
    class SlowHistory extends InMemoryHistoryStore {
      gate: Promise<void> | undefined;
      override async add(e: Parameters<InMemoryHistoryStore['add']>[0]): Promise<void> {
        await super.add(e);
        if (this.gate) await this.gate;
      }
    }
    const history = new SlowHistory();
    let open!: () => void;
    history.gate = new Promise<void>((r) => (open = r));
    const { mgr } = setup({ history, answer: new Promise<OfferAnswer>(() => {}), policy: () => ({ decision: 'accept', reason: 'test' }) });
    const first = mgr.delegate(req(), ctx); // blocked inside history.add
    await flush();
    history.gate = undefined;
    const second = await mgr.delegate(req(), ctx); // wins: becomes the pending challenge
    open();
    const loser = await first;
    expect(second.status).toBe('pending');
    expect(loser.status).toBe('declined_by_policy');
    expect(loser.message).toContain('busy');
    expect(history.all().find((e) => e.id === loser.id)).toMatchObject({ status: 'declined_by_policy', offered: false });
  });
});

describe('wait', () => {
  it('reports unknown ids as cancelled', async () => {
    const { mgr } = setup();
    const r = await mgr.wait({ id: 'nope' }, ctx);
    expect(r.status).toBe('cancelled');
    expect(r.message).toContain('implement it yourself');
  });

  it('times out with the current snapshot while active', async () => {
    vi.useFakeTimers();
    try {
      const { mgr } = setup();
      const { id } = await mgr.delegate(req(), ctx);
      await vi.advanceTimersByTimeAsync(0);
      const p = mgr.wait({ id, timeoutSec: 5 }, ctx);
      await vi.advanceTimersByTimeAsync(5000);
      const r = await p;
      expect(r.status).toBe('active');
      expect(r.message).toContain('Call diby_wait again');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves as soon as the challenge passes', async () => {
    const { mgr } = setup({ reflection: ' neat ' });
    const { id } = await mgr.delegate(req(), ctx);
    await flush();
    const p = mgr.wait({ id, timeoutSec: 30 }, ctx);
    await mgr.runTests();
    const r = await p;
    expect(r).toMatchObject({
      status: 'passed',
      code: 'def parse(x):\n    return 1\n',
      codeRange: { startLine: 3, endLine: 4 },
      reflection: 'neat',
      testsPassed: 4,
      testsTotal: 4,
    });
    expect(r.message).toContain('Do NOT rewrite');
    expect(r.notes).toMatch(/Passed 4\/4 tests after 1 run/);
  });

  it('returns immediately for terminal and on abort', async () => {
    const { mgr } = setup({ answer: 'skip' });
    const { id } = await mgr.delegate(req(), ctx);
    await flush();
    expect((await mgr.wait({ id, timeoutSec: 45 }, ctx)).message).toContain('yourself');

    const s = setup();
    const r = await s.mgr.delegate(req(), ctx);
    await flush();
    const ac = new AbortController();
    const p = s.mgr.wait({ id: r.id, timeoutSec: 45 }, { signal: ac.signal });
    ac.abort();
    expect((await p).status).toBe('active');
  });

  it('dispose releases waiters and cancels the open challenge', async () => {
    const { mgr } = setup();
    const { id } = await mgr.delegate(req(), ctx);
    await flush();
    const p = mgr.wait({ id, timeoutSec: 45 }, ctx);
    mgr.dispose();
    expect((await p).status).toBe('cancelled');
  });
});

describe('runTests / giveUp / cancel', () => {
  it('failing run keeps challenge active and counts attempts', async () => {
    const { mgr, ui } = setup({ results: [run(false), run(true)] });
    const { id } = await mgr.delegate(req(), ctx);
    await flush();
    const r1 = await mgr.runTests();
    expect(r1?.ok).toBe(false);
    expect(mgr.get(id)).toMatchObject({ status: 'active', attempts: 1, testsRunning: false });
    expect(ui.saveFile).toHaveBeenCalled();
    await mgr.runTests(id);
    expect(mgr.get(id)).toMatchObject({ status: 'passed', attempts: 2 });
    expect(ui.clear).toHaveBeenCalled();
    expect(mgr.current()).toBeUndefined();
  });

  it('refuses concurrent runs', async () => {
    const { mgr, runTests } = setup();
    await mgr.delegate(req(), ctx);
    await flush();
    const [a, b] = await Promise.all([mgr.runTests(), mgr.runTests()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(runTests).toHaveBeenCalledOnce();
  });

  it('skips reflection when disabled', async () => {
    const { mgr, ui } = setup({ settings: { askForReflection: false } });
    await mgr.delegate(req(), ctx);
    await flush();
    await mgr.runTests();
    expect(ui.askReflection).not.toHaveBeenCalled();
  });

  it('survives a throwing test runner', async () => {
    const s = setup();
    s.runTests.mockRejectedValueOnce(new Error('boom'));
    const { id } = await s.mgr.delegate(req(), ctx);
    await flush();
    expect(await s.mgr.runTests()).toBeUndefined();
    expect(s.mgr.get(id)).toMatchObject({ status: 'active', testsRunning: false });
    expect(s.ui.notify).toHaveBeenCalled();
  });

  it('giveUp captures partial code; declined confirmation keeps it active', async () => {
    const no = setup({ confirm: false });
    const a = await no.mgr.delegate(req(), ctx);
    await flush();
    await no.mgr.giveUp();
    expect(no.mgr.get(a.id)?.status).toBe('active');

    const { mgr } = setup();
    const { id } = await mgr.delegate(req(), ctx);
    await flush();
    await mgr.giveUp();
    const w = await mgr.wait({ id }, ctx);
    expect(w.status).toBe('gave_up');
    expect(w.code).toContain('def parse');
    expect(w.message).toContain('yourself');
  });

  it('cancel works while pending and active, and is a no-op when terminal', async () => {
    const p = setup({ answer: new Promise<OfferAnswer>(() => {}) });
    const { id } = await p.mgr.delegate(req(), ctx);
    const c = await p.mgr.cancel({ id, reason: 'changed plan' }, ctx);
    expect(c.status).toBe('cancelled');
    expect(p.mgr.current()).toBeUndefined();

    const a = setup();
    const r = await a.mgr.delegate(req(), ctx);
    await flush();
    await a.mgr.cancel({ id: r.id }, ctx);
    expect(a.mgr.get(r.id)?.status).toBe('cancelled');
    expect((await a.mgr.cancel({ id: r.id }, ctx)).status).toBe('cancelled');

    const done = setup();
    const d = await done.mgr.delegate(req(), ctx);
    await flush();
    await done.mgr.runTests();
    expect((await done.mgr.cancel({ id: d.id }, ctx)).status).toBe('passed');
  });

  it('ignores a late offer answer after cancel', async () => {
    let resolve!: (a: OfferAnswer) => void;
    const answer = new Promise<OfferAnswer>((r) => (resolve = r));
    const { mgr, ui } = setup({ answer });
    const { id } = await mgr.delegate(req(), ctx);
    await mgr.cancel({ id }, ctx);
    resolve('accept');
    await flush();
    expect(mgr.get(id)?.status).toBe('cancelled');
    expect(ui.show).not.toHaveBeenCalled();
  });

  it('an unanswered offer is declined with its own reason, a skip with "skipped"', async () => {
    const timedOut = setup({ answer: 'timeout' });
    const a = await timedOut.mgr.delegate(req(), ctx);
    await flush();
    expect(timedOut.mgr.get(a.id)).toMatchObject({ status: 'declined', reason: 'not answered in time' });
    expect(timedOut.history.all()[0]).toMatchObject({ status: 'declined', offered: true });
    expect(timedOut.ui.show).not.toHaveBeenCalled();

    const skipped = setup({ answer: 'skip' });
    const b = await skipped.mgr.delegate(req(), ctx);
    await flush();
    expect(skipped.mgr.get(b.id)).toMatchObject({ status: 'declined', reason: 'skipped' });
  });

  it('snooze declines a pending offer', async () => {
    const { mgr } = setup({ answer: new Promise<OfferAnswer>(() => {}) });
    const { id } = await mgr.delegate(req(), ctx);
    mgr.snooze();
    expect(mgr.get(id)?.status).toBe('declined');
  });
});

describe('preferences, demo, events', () => {
  it('reports settings, busy and snoozed', async () => {
    const { mgr } = setup({ settings: { mode: 'checkup', focusConcepts: ['regex'], maxDifficulty: 4 } });
    const p = await mgr.preferences({}, ctx);
    expect(p).toMatchObject({ mode: 'checkup', maxDifficulty: 4, busy: false, snoozed: false });
    expect(p.guidance).toContain('regex');
    await mgr.delegate(req(), ctx);
    expect((await mgr.preferences({}, ctx)).busy).toBe(true);
  });

  it('startDemo bypasses policy and history', async () => {
    const { mgr, ui, history } = setup({ settings: { mode: 'off' } });
    const r = await mgr.startDemo(req(), ctx);
    expect(r.status).toBe('pending');
    expect(mgr.get(r.id)?.status).toBe('active');
    expect(ui.offer).not.toHaveBeenCalled();
    expect(ui.show).toHaveBeenCalled();
    await mgr.runTests();
    expect(mgr.get(r.id)?.status).toBe('passed');
    expect(history.all()).toHaveLength(0);
  });

  it('emits change events and supports unsubscribe', async () => {
    const { mgr } = setup();
    const seen: string[] = [];
    const sub = mgr.onDidChange((c: Challenge) => seen.push(c.status));
    await mgr.delegate(req(), ctx);
    await flush();
    expect(seen).toEqual(['pending', 'active']);
    sub.dispose();
    await mgr.runTests();
    expect(seen).toEqual(['pending', 'active']);
  });

  it('showPanel reveals current or latest', async () => {
    const { mgr, ui } = setup();
    const { id } = await mgr.delegate(req(), ctx);
    await flush();
    await mgr.showPanel();
    expect(ui.reveal).toHaveBeenCalledWith(mgr.get(id));
  });
});
