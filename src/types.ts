/**
 * Diby shared contract.
 *
 * Every cross-module type lives here. This file is owned by the architect: implementers
 * import from it but do not edit it. If you need a change, raise it with the integrator.
 *
 * Conventions used throughout:
 * - Line numbers are **1-based and inclusive** (what agents and humans see in editors).
 *   Convert to VS Code's 0-based positions only inside `src/ui`.
 * - Timestamps are epoch milliseconds (`Date.now()`).
 * - Nothing in this file may import `vscode`.
 */

// ---------------------------------------------------------------------------
// Basic shapes
// ---------------------------------------------------------------------------

/** A 1-based, inclusive line range within a file. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

/** Difficulty rating supplied by the agent: 1 = warm-up, 5 = hard. */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

/** How often Diby accepts delegated functions. See `diby.mode` in package.json. */
export type DibyMode = 'off' | 'checkup' | 'steady' | 'learn';

/**
 * Lifecycle of a challenge.
 *
 * ```
 * delegate ─┬─> declined_by_policy                     (terminal, immediate)
 *           └─> pending ─┬─> declined                  (user chose Skip / Snooze / ignored the offer)
 *                        ├─> cancelled                 (agent called diby_cancel)
 *                        └─> active ─┬─> passed        (all tests green; code captured)
 *                                    ├─> gave_up       (user clicked Give up)
 *                                    └─> cancelled     (agent called diby_cancel)
 * ```
 * Agents keep polling `diby_wait` while the status is `pending` or `active`.
 */
export type ChallengeStatus =
  | 'pending'
  | 'active'
  | 'declined_by_policy'
  | 'declined'
  | 'passed'
  | 'gave_up'
  | 'cancelled';

/** Statuses after which the challenge never changes again. */
export type TerminalChallengeStatus = Exclude<ChallengeStatus, 'pending' | 'active'>;

/** The four tools exposed to agents. Bridge routes are `POST /tool/<ToolName>`; MCP names are `diby_<ToolName>`. */
export type ToolName = 'delegate' | 'wait' | 'cancel' | 'preferences';

// ---------------------------------------------------------------------------
// Tool requests / responses (the agent-facing API). Zod mirrors live in src/schemas.ts.
// ---------------------------------------------------------------------------

/**
 * `diby_delegate` input. Before calling, the agent has already written a stub for `symbol`
 * in `file` (Python: body is `raise NotImplementedError("DIBY: ...")`) and the test file(s).
 */
export interface DelegateRequest {
  /** File containing the stub. Absolute, or relative to the agent's cwd / workspace folder. */
  file: string;
  /** Lines spanned by the whole stubbed function, signature included (1-based, inclusive). */
  range: LineRange;
  /** Function or method name, e.g. `parse_duration` or `Tokenizer.next_token`. */
  symbol: string;
  /** The exact signature line(s), e.g. `def parse_duration(text: str) -> int:`. */
  signature: string;
  /** Markdown spec for the human: behaviour, inputs/outputs, edge cases, examples. */
  spec: string;
  /** Shell command that runs ONLY this function's tests, e.g. `pytest tests/test_duration.py -q`. */
  testCommand: string;
  /** Test files written by the agent (absolute or relative like `file`). Shown in the panel. */
  testFiles: string[];
  /** Language id: `python`, or anything else for the generic (exit-code-only) adapter. */
  language: string;
  /** Concept tags, lowercase kebab-case, e.g. `["parsing", "regex"]`. Used by the policy. */
  concepts: string[];
  /** Agent's difficulty estimate. */
  difficulty: Difficulty;
  /**
   * Optional working directory for `testCommand`. Relative paths resolve against the agent's cwd
   * (`ToolCallContext.cwd`), else the workspace folder. Default: the agent's cwd when it is inside
   * the workspace folder, else the workspace folder root.
   */
  cwd?: string;
  /** Optional reference implementation, revealed to the human only after they pass or give up. Never written to disk. */
  referenceSolution?: string;
}

/** `diby_delegate` output. */
export interface DelegateResponse {
  id: string;
  /** `declined_by_policy` (write it yourself now) or `pending` (poll `diby_wait`). */
  status: Extract<ChallengeStatus, 'pending' | 'declined_by_policy'>;
  /** Human/agent-readable explanation, e.g. why it was declined or what to do next. */
  message: string;
}

/** `diby_wait` input. Long-poll: returns as soon as the challenge reaches a terminal status, or after `timeoutSec`. */
export interface WaitRequest {
  id: string;
  /** 0..45, default 30. Clients cannot tolerate long blocking tool calls, so keep this short and loop. */
  timeoutSec?: number;
}

/** `diby_wait` output. */
export interface WaitResponse {
  id: string;
  status: ChallengeStatus;
  /**
   * Present for `passed` (the human's implementation, VERBATIM; integrate it unchanged) and,
   * when available, for `gave_up` (partial attempt, for context only).
   */
  code?: string;
  /** Line range the captured `code` occupied when captured (1-based, inclusive). */
  codeRange?: LineRange;
  /** Machine-written summary, e.g. "Passed 6/6 tests after 3 runs (11m)". */
  notes?: string;
  /** Optional one-line reflection typed by the human after passing. */
  reflection?: string;
  /** Number of tests passing in the latest run. */
  testsPassed?: number;
  /** Number of tests in the latest run. */
  testsTotal?: number;
  /** What the agent should do next, in plain words. Always present. */
  message: string;
}

/** `diby_cancel` input. */
export interface CancelRequest {
  id: string;
  /** Optional reason shown to the human. */
  reason?: string;
}

/** `diby_cancel` output. Cancelling a terminal challenge is a no-op that returns its final status. */
export interface CancelResponse {
  id: string;
  status: ChallengeStatus;
  message: string;
}

/** `diby_preferences` input (no arguments). */
export type PreferencesRequest = Record<string, never>;

/** `diby_preferences` output, so agents only offer functions the human wants. */
export interface Preferences {
  mode: DibyMode;
  focusConcepts: string[];
  avoidConcepts: string[];
  maxDifficulty: Difficulty;
  /** True when the user snoozed Diby for this VS Code session (everything is declined). */
  snoozed: boolean;
  /** True when a challenge is already pending/active (a new delegate would be declined). */
  busy: boolean;
  /** One or two sentences of guidance for the agent, derived from the above. */
  guidance: string;
}

// ---------------------------------------------------------------------------
// Bridge contract (HTTP server <-> ChallengeManager)
// ---------------------------------------------------------------------------

/** Per-call context the bridge passes to handlers. */
export interface ToolCallContext {
  /** The agent's working directory, sent by the shim as the `X-Diby-Cwd` header. Used to resolve relative paths. */
  cwd?: string;
  /** Aborted when the HTTP client disconnects (lets `wait` stop long-polling early). */
  signal?: AbortSignal;
}

/**
 * What the bridge server calls. `ChallengeManager` implements it.
 * Requests arrive already validated by the zod schemas in src/schemas.ts.
 * Handlers should not throw for expected situations (unknown id, busy, ...): return a status + message instead.
 */
export interface ToolHandlers {
  delegate(req: DelegateRequest, ctx: ToolCallContext): Promise<DelegateResponse>;
  wait(req: WaitRequest, ctx: ToolCallContext): Promise<WaitResponse>;
  cancel(req: CancelRequest, ctx: ToolCallContext): Promise<CancelResponse>;
  preferences(req: PreferencesRequest, ctx: ToolCallContext): Promise<Preferences>;
}

/** Error body returned by the bridge for non-2xx responses. */
export interface BridgeErrorBody {
  error: 'unauthorized' | 'not_found' | 'invalid_request' | 'internal';
  message: string;
  /** zod issues for `invalid_request`. */
  issues?: unknown;
}

/** Contents of `~/.diby/endpoints/<sha1(normalizedWorkspacePath)>.json`. One file per workspace folder. */
export interface EndpointInfo {
  /** File format version; currently 1. */
  version: 1;
  /** Bridge port on 127.0.0.1. */
  port: number;
  /** Bearer token required on every request. */
  token: string;
  /** Extension host pid; used by the shim to skip stale files. */
  pid: number;
  /** Normalized absolute workspace folder path. */
  workspace: string;
  /** When the file was written (epoch ms). */
  writtenAt: number;
  /** Extension version that wrote it. */
  extensionVersion: string;
}

/** Handle returned by `startBridge`. */
export interface BridgeServer {
  readonly port: number;
  readonly token: string;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Challenges (internal state held by ChallengeManager)
// ---------------------------------------------------------------------------

/** A file path resolved against the workspace. */
export interface ResolvedFile {
  /** Absolute path. */
  absPath: string;
  /** Absolute path of the containing workspace folder. */
  workspaceFolder: string;
}

/** Full internal state of one delegated function. */
export interface Challenge {
  id: string;
  request: DelegateRequest;
  status: ChallengeStatus;
  /** Resolved stub file. Undefined only when resolution failed (then status is `declined_by_policy`). */
  file?: ResolvedFile;
  /** Resolved test files (absolute paths). */
  testFiles: string[];
  /** Latest known range of the function; updated as the user edits. */
  range: LineRange;
  createdAt: number;
  updatedAt: number;
  /** When the user accepted (status became `active`). */
  acceptedAt?: number;
  /** When a terminal status was reached. */
  finishedAt?: number;
  /** Number of test runs so far. */
  attempts: number;
  /** True while a test run is in progress (UI shows a spinner; a second run is refused). */
  testsRunning?: boolean;
  /** Absolute directory the tests run in (resolved from `request.cwd`). */
  testCwd?: string;
  lastRun?: TestRunResult;
  /** Captured implementation (verbatim) once passed / gave up. */
  code?: string;
  reflection?: string;
  notes?: string;
  /** Why it was declined/cancelled, or other status explanation. */
  reason?: string;
  /** True for challenges started via `diby.startDemoChallenge` (bypass policy, not recorded in history). */
  demo?: boolean;
}

/** Answer to the "Accept / Skip / Snooze" offer. `skip` is also used when the offer is dismissed or times out. */
export type OfferAnswer = 'accept' | 'skip' | 'snooze';

// ---------------------------------------------------------------------------
// Policy + history
// ---------------------------------------------------------------------------

/** User settings that drive the policy. */
export interface PolicySettings {
  mode: DibyMode;
  focusConcepts: string[];
  avoidConcepts: string[];
  maxDifficulty: Difficulty;
}

/** All Diby settings (`diby.*` in package.json). */
export interface DibySettings extends PolicySettings {
  testTimeoutSec: number;
  askForReflection: boolean;
}

/** The subset of a request the policy looks at. */
export type PolicyCandidate = Pick<DelegateRequest, 'concepts' | 'difficulty' | 'language' | 'symbol'>;

/** Result of the policy. `reason` is always filled (it is shown to the agent on decline, logged on accept). */
export interface PolicyDecision {
  decision: 'accept' | 'decline';
  reason: string;
}

/** Pure policy function signature. Must not read clocks, settings or storage itself. */
export type PolicyFn = (
  candidate: PolicyCandidate,
  history: readonly HistoryEntry[],
  settings: PolicySettings,
  now: number,
) => PolicyDecision;

/** One persisted record per non-demo delegate call (including policy declines). */
export interface HistoryEntry {
  id: string;
  createdAt: number;
  /** Last known status (updated as the challenge progresses). */
  status: ChallengeStatus;
  /** True if the human was shown the offer (i.e. the policy accepted). Rate limits count these. */
  offered: boolean;
  symbol: string;
  language: string;
  concepts: string[];
  difficulty: Difficulty;
  finishedAt?: number;
  attempts?: number;
}

/** Minimal key/value store; structurally compatible with `vscode.Memento` (pass `context.globalState`). */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** Persisted challenge history (newest last). */
export interface HistoryStore {
  /** Snapshot of all entries, oldest first. */
  all(): readonly HistoryEntry[];
  /** Append an entry (trims to a bounded size). */
  add(entry: HistoryEntry): Promise<void>;
  /** Merge `patch` into the entry with `id`; no-op if absent. */
  update(id: string, patch: Partial<Omit<HistoryEntry, 'id'>>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Testing + language adapters
// ---------------------------------------------------------------------------

/** Outcome of one test case. */
export interface TestCaseResult {
  /** Test name, e.g. `test_handles_empty_string`. */
  name: string;
  /** Class / suite / module, e.g. `tests.test_duration`. */
  classname?: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  /** Test file (absolute or relative to the run cwd) if known. */
  file?: string;
  /** 1-based line of the test, if known. */
  line?: number;
  durationMs?: number;
  /** Short failure message, e.g. `AssertionError: assert 3 == 4`. */
  message?: string;
  /** Full failure text / traceback. */
  details?: string;
}

/** A problem to surface as an editor diagnostic. */
export interface TestDiagnostic {
  /** Absolute path, or relative to the run cwd. */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column, if known. */
  column?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

/** Result of one test run. */
export interface TestRunResult {
  /** True iff the run completed, exit code was 0 and no case failed/errored (and at least one case ran, when cases are known). */
  ok: boolean;
  /** The command actually executed (after instrumentation). */
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  startedAt: number;
  durationMs: number;
  /** Per-test results; empty when the adapter cannot tell (generic adapter). */
  cases: TestCaseResult[];
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  total: number;
  /** Combined output, truncated to a sane size (~200 KB each). */
  stdout: string;
  stderr: string;
  diagnostics: TestDiagnostic[];
}

/** Raw process outcome handed to `LanguageAdapter.parseResults`. */
export interface RawTestOutput {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  startedAt: number;
  durationMs: number;
  /** Contents of `InstrumentedCommand.reportPath`, if the file existed after the run. */
  reportXml?: string;
}

/** Inputs available when instrumenting a command. */
export interface InstrumentContext {
  /** Absolute workspace folder. */
  workspaceFolder: string;
  /** Absolute directory the command will run in. */
  cwd: string;
  /** Interpreter from `resolveInterpreter`, if any. */
  interpreter?: string;
}

/** A test command after adapter instrumentation. */
export interface InstrumentedCommand {
  /** Shell command to run. */
  cmd: string;
  /** Where the adapter expects a machine-readable report (e.g. JUnit XML). */
  reportPath?: string;
  /** Extra env vars (merged over `process.env`). */
  env?: Record<string, string>;
}

/** Result of stub validation. */
export interface StubValidation {
  ok: boolean;
  /** Human-readable problems when `ok` is false. */
  problems: string[];
}

/**
 * Per-language behaviour. Implementations are pure (no `vscode` import); anything that needs
 * VS Code (e.g. asking the Python extension for an interpreter) is injected as a function.
 * Future adapters (C++, C, Java, TS/JS) fit this shape: build steps go in `cmd`, sandbox
 * files in `tmpDir`, compiler errors in `TestRunResult.diagnostics`.
 */
export interface LanguageAdapter {
  /** Canonical id, e.g. `python`, `generic`. */
  readonly id: string;
  readonly displayName: string;
  /** Other language strings that map to this adapter, e.g. `py`. Matched case-insensitively. */
  readonly aliases: readonly string[];
  /** Check that `range` of `text` (whole file) holds a Diby stub for this language. */
  validateStub(text: string, range: LineRange): StubValidation;
  /**
   * Find the current extent of `symbol` in `text`, starting near `hint`. Used to capture the
   * implementation after the user has edited (ranges drift). Return undefined if not found.
   */
  locateSymbol?(text: string, symbol: string, hint: LineRange): LineRange | undefined;
  /** Rewrite/augment the agent's test command so results can be parsed. `tmpDir` is a fresh, writable temp dir. */
  instrumentTestCommand(cmd: string, tmpDir: string, ctx: InstrumentContext): InstrumentedCommand;
  /** Turn raw process output (and optional report) into a TestRunResult. */
  parseResults(raw: RawTestOutput): TestRunResult;
  /** Optional: absolute interpreter path for this workspace folder. */
  resolveInterpreter?(workspaceFolder: string): Promise<string | undefined>;
}

/** Looks up adapters by language string; unknown languages get the generic adapter. */
export interface LanguageRegistry {
  get(language: string): LanguageAdapter;
  /** True if a non-generic adapter handles this language. */
  has(language: string): boolean;
  list(): readonly LanguageAdapter[];
}

/** Options for `runTests` in src/testing/runner.ts. */
export interface RunTestsOptions {
  /** The agent's test command, un-instrumented. */
  command: string;
  /** Absolute directory to run in. */
  cwd: string;
  workspaceFolder: string;
  adapter: LanguageAdapter;
  timeoutSec: number;
  /** Extra env vars. */
  env?: Record<string, string>;
  /** Abort to kill the process tree. */
  signal?: AbortSignal;
}

/** Signature of `runTests`. */
export type RunTestsFn = (opts: RunTestsOptions) => Promise<TestRunResult>;

// ---------------------------------------------------------------------------
// ChallengeManager dependencies (all injected so the manager is unit-testable without VS Code)
// ---------------------------------------------------------------------------

/** VS Code-facing side effects the ChallengeManager needs. Implemented in src/ui. */
export interface ChallengeUi {
  /** Show the Accept / Skip / Snooze offer. Must resolve (use `skip` on dismiss/timeout). */
  offer(challenge: Challenge): Promise<OfferAnswer>;
  /** Present an active challenge: open file, decorate region, panel, CodeLens, status bar, context key. */
  show(challenge: Challenge): Promise<void>;
  /** Re-render all views (status or test results changed). Also applies `lastRun.diagnostics`. */
  refresh(challenge: Challenge): void;
  /** Remove every trace of the challenge from the UI (decorations, CodeLens, diagnostics, status bar). Panel may stay open showing the final state. */
  clear(challenge: Challenge): void;
  /** Bring the panel to front. */
  reveal(challenge: Challenge): Promise<void>;
  /** Current text of the function, verbatim, plus where it is now. Reads the live (possibly unsaved) document. */
  captureCode(challenge: Challenge, adapter: LanguageAdapter): Promise<{ code: string; range: LineRange }>;
  /** Save the stub file if dirty (before running tests). */
  saveFile(challenge: Challenge): Promise<void>;
  /** Optional one-line reflection after passing. Resolves undefined if skipped. */
  askReflection(challenge: Challenge): Promise<string | undefined>;
  /** Confirm Give up. */
  confirmGiveUp(challenge: Challenge): Promise<boolean>;
  /** Non-blocking notification. */
  notify(message: string, level?: 'info' | 'warning' | 'error'): void;
}

/** Workspace access for path resolution and reading files (VS Code-backed in production). */
export interface WorkspaceAccess {
  /** Resolve `file` (absolute or relative to `cwd`, then to each workspace folder) to an existing file inside a workspace folder. */
  resolve(file: string, cwd?: string): ResolvedFile | undefined;
  /** Text of the file, from the open document if any (may be unsaved), else from disk. */
  readText(absPath: string): Promise<string>;
}

/** Everything ChallengeManager needs, injected by src/extension.ts. */
export interface ChallengeManagerDeps {
  ui: ChallengeUi;
  workspace: WorkspaceAccess;
  history: HistoryStore;
  languages: LanguageRegistry;
  runTests: RunTestsFn;
  decide: PolicyFn;
  getSettings(): DibySettings;
  log(message: string): void;
  /** Injectable clock (tests). Defaults to Date.now. */
  now?(): number;
  /** Injectable id generator (tests). Defaults to crypto.randomUUID. */
  newId?(): string;
}

/** Minimal disposable (structurally compatible with vscode.Disposable). */
export interface DisposableLike {
  dispose(): void;
}
