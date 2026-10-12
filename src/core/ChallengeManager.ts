/**
 * MODULE core-ui — owns challenge state and the lifecycle. Implements ToolHandlers for the bridge.
 * Must NOT import vscode: every side effect goes through injected deps, so it is unit-testable.
 */
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { WAIT_DEFAULT_SEC, WAIT_MAX_SEC } from '../constants';
import type {
  CancelRequest,
  CancelResponse,
  Challenge,
  ChallengeManagerDeps,
  ChallengeStatus,
  DelegateRequest,
  DelegateResponse,
  DisposableLike,
  HistoryEntry,
  LanguageAdapter,
  Preferences,
  PreferencesRequest,
  TestRunResult,
  ToolCallContext,
  ToolHandlers,
  WaitRequest,
  WaitResponse,
} from '../types';

type ChangeListener = (challenge: Challenge) => void;

const UNKNOWN_MESSAGE = 'Unknown challenge (VS Code may have restarted) — implement it yourself.';

function isInProgress(status: ChallengeStatus): boolean {
  return status === 'pending' || status === 'active';
}

function formatMinutes(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Coordinates policy, UI prompts, test runs and the agent-facing tool handlers. */
export class ChallengeManager implements ToolHandlers, DisposableLike {
  private readonly challenges = new Map<string, Challenge>();
  private readonly listeners = new Set<ChangeListener>();
  private isSnoozed = false;
  private disposed = false;

  constructor(private readonly deps: ChallengeManagerDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private newId(): string {
    return (this.deps.newId ?? randomUUID)();
  }

  // --- ToolHandlers (called by the bridge) ---

  async delegate(req: DelegateRequest, ctx: ToolCallContext): Promise<DelegateResponse> {
    const id = this.newId();
    const declined = (message: string): DelegateResponse => ({ id, status: 'declined_by_policy', message });

    if (this.isSnoozed) return declined('Snoozed for this session. Implement the function yourself.');
    if (this.current()) return declined('busy: another Diby challenge is in progress. Implement the function yourself.');

    const prepared = await this.prepare(req, ctx);
    if ('error' in prepared) return declined(prepared.error);

    const settings = this.deps.getSettings();
    const now = this.now();
    const verdict = this.deps.decide(
      { concepts: req.concepts, difficulty: req.difficulty, language: req.language, symbol: req.symbol },
      this.deps.history.all(),
      settings,
      now,
    );
    const offered = verdict.decision === 'accept';
    const entry: HistoryEntry = {
      id,
      createdAt: now,
      status: offered ? 'pending' : 'declined_by_policy',
      offered,
      symbol: req.symbol,
      language: req.language,
      concepts: req.concepts,
      difficulty: req.difficulty,
      ...(offered ? {} : { finishedAt: now }),
    };
    await this.deps.history.add(entry);
    this.deps.log(`delegate ${req.symbol}: ${verdict.decision} (${verdict.reason})`);
    if (!offered) {
      return declined(`Declined by policy: ${verdict.reason}. Implement the function yourself.`);
    }

    // The await above could have raced with another delegate call. Rewrite the history entry so this
    // never-shown offer does not stay `pending` forever or count against the rate limit.
    if (this.current()) {
      await this.deps.history
        .update(id, { status: 'declined_by_policy', offered: false, finishedAt: now })
        .catch((err: unknown) => this.deps.log(`history update failed: ${String(err)}`));
      return declined('busy: another Diby challenge is in progress. Implement the function yourself.');
    }

    const challenge = this.createChallenge(id, req, prepared, 'pending', now);
    this.emit(challenge);
    void this.runOffer(challenge);
    return {
      id,
      status: 'pending',
      message: 'Offered to the human. Poll diby_wait until the status is no longer pending/active.',
    };
  }

  async wait(req: WaitRequest, ctx: ToolCallContext): Promise<WaitResponse> {
    const challenge = this.challenges.get(req.id);
    if (!challenge) return { id: req.id, status: 'cancelled', message: UNKNOWN_MESSAGE };
    const seconds = Math.min(Math.max(req.timeoutSec ?? WAIT_DEFAULT_SEC, 0), WAIT_MAX_SEC);

    if (isInProgress(challenge.status) && !this.disposed && seconds > 0 && !ctx.signal?.aborted) {
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (): void => {
          if (timer) clearTimeout(timer);
          this.listeners.delete(onChange);
          this.waiters.delete(finish);
          ctx.signal?.removeEventListener('abort', finish);
          resolve();
        };
        const onChange: ChangeListener = (c) => {
          if (c.id === challenge.id && !isInProgress(c.status)) finish();
        };
        this.listeners.add(onChange);
        ctx.signal?.addEventListener('abort', finish, { once: true });
        timer = setTimeout(finish, seconds * 1000);
        this.waiters.add(finish);
      });
    }
    return this.snapshot(challenge);
  }

  /** Release callbacks of in-flight waits (resolved on dispose). */
  private readonly waiters = new Set<() => void>();

  async cancel(req: CancelRequest, _ctx: ToolCallContext): Promise<CancelResponse> {
    const challenge = this.challenges.get(req.id);
    if (!challenge) return { id: req.id, status: 'cancelled', message: UNKNOWN_MESSAGE };
    if (!isInProgress(challenge.status)) {
      return { id: challenge.id, status: challenge.status, message: 'Challenge already finished; nothing to cancel.' };
    }
    challenge.reason = req.reason;
    this.finish(challenge, 'cancelled');
    this.deps.ui.notify(
      req.reason ? `The agent cancelled the Diby challenge: ${req.reason}` : 'The agent cancelled the Diby challenge.',
      'info',
    );
    return {
      id: challenge.id,
      status: 'cancelled',
      message: `Cancelled. Implement ${challenge.request.symbol} yourself.`,
    };
  }

  async preferences(_req: PreferencesRequest, _ctx: ToolCallContext): Promise<Preferences> {
    const s = this.deps.getSettings();
    const busy = this.current() !== undefined;
    return {
      mode: s.mode,
      focusConcepts: s.focusConcepts,
      avoidConcepts: s.avoidConcepts,
      maxDifficulty: s.maxDifficulty,
      snoozed: this.isSnoozed,
      busy,
      guidance: this.guidance(busy),
    };
  }

  // --- Commands (called by extension.ts / UI). `id` defaults to the current challenge. ---

  /** Start a challenge from a request, bypassing policy and the offer prompt (diby.startDemoChallenge). */
  async startDemo(req: DelegateRequest, ctx: ToolCallContext = {}): Promise<DelegateResponse> {
    const id = this.newId();
    if (this.current()) {
      this.deps.ui.notify('A Diby challenge is already in progress.', 'warning');
      return { id, status: 'declined_by_policy', message: 'busy: another Diby challenge is in progress.' };
    }
    const prepared = await this.prepare(req, ctx);
    if ('error' in prepared) {
      this.deps.ui.notify(`Could not start the demo challenge: ${prepared.error}`, 'error');
      return { id, status: 'declined_by_policy', message: prepared.error };
    }
    const challenge = this.createChallenge(id, req, prepared, 'active', this.now());
    challenge.demo = true;
    challenge.acceptedAt = challenge.createdAt;
    this.emit(challenge);
    await this.deps.ui.show(challenge);
    return { id, status: 'pending', message: 'Demo challenge started.' };
  }

  /** Save the file, run the tests, update state; on all-green capture code and finish as `passed`. */
  async runTests(id?: string): Promise<TestRunResult | undefined> {
    const challenge = this.resolveTarget(id);
    if (!challenge || challenge.status !== 'active' || !challenge.file) return undefined;
    if (challenge.testsRunning) {
      this.deps.ui.notify('Tests are already running.', 'info');
      return undefined;
    }
    const adapter = this.deps.languages.get(challenge.request.language);
    challenge.testsRunning = true;
    this.emit(challenge);
    this.deps.ui.refresh(challenge);

    let result: TestRunResult;
    try {
      await this.deps.ui.saveFile(challenge);
      result = await this.deps.runTests({
        command: challenge.request.testCommand,
        cwd: challenge.testCwd ?? challenge.file.workspaceFolder,
        workspaceFolder: challenge.file.workspaceFolder,
        adapter,
        timeoutSec: this.deps.getSettings().testTimeoutSec,
      });
    } catch (err) {
      challenge.testsRunning = false;
      this.emit(challenge);
      this.deps.ui.refresh(challenge);
      this.deps.log(`runTests failed: ${String(err)}`);
      this.deps.ui.notify(`Could not run tests: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return undefined;
    }

    challenge.testsRunning = false;
    challenge.attempts += 1;
    challenge.lastRun = result;
    // The challenge may have been cancelled or given up while the tests ran.
    if (challenge.status !== 'active') {
      this.emit(challenge);
      this.deps.ui.refresh(challenge);
      return result;
    }
    this.emit(challenge);
    this.deps.ui.refresh(challenge);
    this.updateHistory(challenge, { attempts: challenge.attempts });

    if (result.ok) await this.complete(challenge, adapter, result);
    return result;
  }

  /** Confirm, then finish as `gave_up` (captures partial code, reveals referenceSolution in the panel). */
  async giveUp(id?: string): Promise<void> {
    const challenge = this.resolveTarget(id);
    if (!challenge || challenge.status !== 'active') return;
    if (!(await this.deps.ui.confirmGiveUp(challenge))) return;
    if (challenge.status !== 'active') return;
    const adapter = this.deps.languages.get(challenge.request.language);
    await this.captureInto(challenge, adapter);
    if (challenge.status !== 'active') return;
    challenge.notes = `Gave up after ${challenge.attempts} run${challenge.attempts === 1 ? '' : 's'}${this.elapsedSuffix(challenge)}.`;
    this.finish(challenge, 'gave_up');
  }

  /** Reveal the challenge panel. */
  async showPanel(id?: string): Promise<void> {
    const challenge = this.resolveTarget(id) ?? this.latest();
    if (challenge) await this.deps.ui.reveal(challenge);
  }

  /** Decline everything for the rest of this VS Code session (also declines a pending offer). */
  snooze(): void {
    this.isSnoozed = true;
    const pending = this.current();
    if (pending && pending.status === 'pending') {
      pending.reason = 'snoozed';
      this.finish(pending, 'declined');
    }
  }

  get snoozed(): boolean {
    return this.isSnoozed;
  }

  /** The pending/active challenge, if any (at most one at a time). */
  current(): Challenge | undefined {
    for (const c of this.challenges.values()) if (isInProgress(c.status)) return c;
    return undefined;
  }

  /** Look up any challenge from this session by id. */
  get(id: string): Challenge | undefined {
    return this.challenges.get(id);
  }

  /** Fires after every state change of any challenge. */
  onDidChange(listener: (challenge: Challenge) => void): DisposableLike {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  /** Cancel pending work, resolve waiters with current state. */
  dispose(): void {
    this.disposed = true;
    for (const release of [...this.waiters]) release();
    this.waiters.clear();
    const open = this.current();
    if (open) {
      open.reason = 'VS Code closed or Diby was disabled';
      this.finish(open, 'cancelled');
    }
    this.listeners.clear();
  }

  // --- internals ---

  private async prepare(
    req: DelegateRequest,
    ctx: ToolCallContext,
  ): Promise<{ error: string } | { file: NonNullable<Challenge['file']>; testFiles: string[]; testCwd: string }> {
    const file = this.deps.workspace.resolve(req.file, ctx.cwd);
    if (!file) return { error: 'file not found in an open workspace folder. Implement the function yourself.' };

    let text: string;
    try {
      text = await this.deps.workspace.readText(file.absPath);
    } catch (err) {
      return { error: `could not read ${req.file}: ${String(err)}` };
    }
    const check = this.deps.languages.get(req.language).validateStub(text, req.range);
    if (!check.ok) return { error: `stub validation failed: ${check.problems.join('; ')}` };

    const base = ctx.cwd && path.isAbsolute(ctx.cwd) ? ctx.cwd : file.workspaceFolder;
    const testFiles = req.testFiles.map(
      (f) => this.deps.workspace.resolve(f, ctx.cwd)?.absPath ?? path.resolve(base, f),
    );
    let testCwd: string;
    if (req.cwd) testCwd = path.resolve(base, req.cwd);
    else testCwd = ctx.cwd && path.isAbsolute(ctx.cwd) && isInside(file.workspaceFolder, ctx.cwd) ? ctx.cwd : file.workspaceFolder;
    return { file, testFiles, testCwd };
  }

  private createChallenge(
    id: string,
    request: DelegateRequest,
    prepared: { file: NonNullable<Challenge['file']>; testFiles: string[]; testCwd: string },
    status: ChallengeStatus,
    now: number,
  ): Challenge {
    const challenge: Challenge = {
      id,
      request,
      status,
      file: prepared.file,
      testFiles: prepared.testFiles,
      range: { ...request.range },
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      testCwd: prepared.testCwd,
    };
    this.challenges.set(id, challenge);
    return challenge;
  }

  private async runOffer(challenge: Challenge): Promise<void> {
    let answer: Awaited<ReturnType<typeof this.deps.ui.offer>>;
    try {
      answer = await this.deps.ui.offer(challenge);
    } catch (err) {
      this.deps.log(`offer failed: ${String(err)}`);
      answer = 'skip';
    }
    if (challenge.status !== 'pending') return;
    if (answer === 'accept') {
      // The agent may have edited the file (e.g. added imports above the stub) while the offer was
      // open; edits are only tracked once the challenge is shown, so re-locate the function first.
      await this.relocate(challenge);
      if (challenge.status !== 'pending') return;
      challenge.status = 'active';
      challenge.acceptedAt = this.now();
      this.emit(challenge);
      this.updateHistory(challenge, { status: 'active' });
      try {
        await this.deps.ui.show(challenge);
      } catch (err) {
        this.deps.log(`show failed: ${String(err)}`);
        challenge.reason = 'could not open the challenge UI';
        this.finish(challenge, 'cancelled');
      }
      return;
    }
    if (answer === 'snooze') this.isSnoozed = true;
    challenge.reason = answer === 'snooze' ? 'snoozed' : answer === 'timeout' ? 'not answered in time' : 'skipped';
    this.finish(challenge, 'declined');
  }

  /** Refresh `challenge.range` from the file's current text via the adapter's locateSymbol, if any. */
  private async relocate(challenge: Challenge): Promise<void> {
    const adapter = this.deps.languages.get(challenge.request.language);
    if (!challenge.file || !adapter.locateSymbol) return;
    try {
      const text = await this.deps.workspace.readText(challenge.file.absPath);
      const found = adapter.locateSymbol(text, challenge.request.symbol, challenge.range);
      if (found) challenge.range = found;
    } catch (err) {
      this.deps.log(`relocate failed: ${String(err)}`);
    }
  }

  private async captureInto(challenge: Challenge, adapter: LanguageAdapter): Promise<void> {
    try {
      const captured = await this.deps.ui.captureCode(challenge, adapter);
      challenge.code = captured.code;
      challenge.range = captured.range;
    } catch (err) {
      this.deps.log(`captureCode failed: ${String(err)}`);
    }
  }

  private async complete(challenge: Challenge, adapter: LanguageAdapter, result: TestRunResult): Promise<void> {
    await this.captureInto(challenge, adapter);
    if (challenge.status !== 'active') return;
    if (this.deps.getSettings().askForReflection) {
      try {
        const text = (await this.deps.ui.askReflection(challenge))?.trim();
        if (text) challenge.reflection = text;
      } catch (err) {
        this.deps.log(`askReflection failed: ${String(err)}`);
      }
      if (challenge.status !== 'active') return;
    }
    const total = result.total > 0 ? result.total : result.passed;
    const counts = total > 0 ? `${result.passed}/${total} tests` : 'tests';
    challenge.notes = `Passed ${counts} after ${challenge.attempts} run${challenge.attempts === 1 ? '' : 's'}${this.elapsedSuffix(challenge)}`;
    this.finish(challenge, 'passed');
  }

  private elapsedSuffix(challenge: Challenge): string {
    return challenge.acceptedAt === undefined ? '' : ` in ${formatMinutes(this.now() - challenge.acceptedAt)}`;
  }

  /** Move to a terminal status, update history and UI, notify listeners. */
  private finish(challenge: Challenge, status: ChallengeStatus): void {
    challenge.status = status;
    challenge.finishedAt = this.now();
    this.updateHistory(challenge, {
      status,
      finishedAt: challenge.finishedAt,
      attempts: challenge.attempts,
    });
    try {
      this.deps.ui.refresh(challenge);
      this.deps.ui.clear(challenge);
    } catch (err) {
      this.deps.log(`ui update failed: ${String(err)}`);
    }
    this.emit(challenge);
  }

  private updateHistory(challenge: Challenge, patch: Partial<Omit<HistoryEntry, 'id'>>): void {
    if (challenge.demo) return;
    this.deps.history.update(challenge.id, patch).catch((err: unknown) => {
      this.deps.log(`history update failed: ${String(err)}`);
    });
  }

  private emit(challenge: Challenge): void {
    challenge.updatedAt = this.now();
    for (const listener of [...this.listeners]) {
      try {
        listener(challenge);
      } catch (err) {
        this.deps.log(`listener failed: ${String(err)}`);
      }
    }
  }

  private resolveTarget(id?: string): Challenge | undefined {
    return id ? this.challenges.get(id) : this.current();
  }

  private latest(): Challenge | undefined {
    let last: Challenge | undefined;
    for (const c of this.challenges.values()) last = c;
    return last;
  }

  private snapshot(c: Challenge): WaitResponse {
    const symbol = c.request.symbol;
    const base: WaitResponse = { id: c.id, status: c.status, message: '' };
    if (c.lastRun) {
      base.testsPassed = c.lastRun.passed;
      base.testsTotal = c.lastRun.total;
    }
    if (c.notes) base.notes = c.notes;
    if (c.reflection) base.reflection = c.reflection;
    if (c.code !== undefined && (c.status === 'passed' || c.status === 'gave_up')) {
      base.code = c.code;
      base.codeRange = { ...c.range };
    }
    switch (c.status) {
      case 'pending':
        base.message = 'Waiting for the human to accept. Call diby_wait again.';
        break;
      case 'active': {
        const progress = c.lastRun ? `${c.lastRun.passed}/${c.lastRun.total} passing` : 'no runs yet';
        base.message = `Human is implementing \`${symbol}\` (${c.attempts} runs, ${progress}). Call diby_wait again; continue unrelated work meanwhile.`;
        break;
      }
      case 'passed':
        base.message = `The human's implementation is already in \`${c.file?.absPath ?? c.request.file}\` lines ${c.range.startLine}-${c.range.endLine} and passes the tests. Do NOT rewrite, reformat or refactor it. Build on it as-is.`;
        break;
      default:
        base.message = `Implement \`${symbol}\` yourself (replace the stub).`;
    }
    return base;
  }

  private guidance(busy: boolean): string {
    const s = this.deps.getSettings();
    if (this.isSnoozed) return 'The user snoozed Diby for this session: do not delegate, implement everything yourself.';
    const parts: string[] = [];
    switch (s.mode) {
      case 'off':
        return 'Diby is off: do not delegate, implement everything yourself.';
      case 'checkup':
        parts.push('Checkup mode: at most one challenge per day; only offer difficulty 3+ functions.');
        break;
      case 'steady':
        parts.push('Steady mode: about one challenge per hour.');
        break;
      case 'learn':
        parts.push('Learn mode: the user wants to practise often; offer suitable functions freely.');
        break;
    }
    parts.push(`Keep difficulty at or below ${s.maxDifficulty}.`);
    if (s.focusConcepts.length) parts.push(`Prefer: ${s.focusConcepts.join(', ')}.`);
    if (s.avoidConcepts.length) parts.push(`Avoid: ${s.avoidConcepts.join(', ')}.`);
    if (busy) parts.push('A challenge is already in progress; new delegations will be declined.');
    return parts.join(' ');
  }
}
