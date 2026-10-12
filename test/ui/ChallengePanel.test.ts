import { describe, expect, it, vi } from 'vitest';
import type { Challenge } from '../../src/types';

// Minimal stand-in for the `vscode` module: just what ChallengePanel touches.
const executeCommand = vi.fn();
const showTextDocument = vi.fn();
let onMessage: ((m: unknown) => void) | undefined;
vi.mock('vscode', () => ({
  ViewColumn: { One: 1, Beside: -2 },
  Uri: { file: (p: string) => ({ fsPath: p }) },
  Range: class {
    constructor(...args: number[]) {
      Object.assign(this, { args });
    }
  },
  commands: { executeCommand: (...a: unknown[]) => executeCommand(...a) },
  window: {
    showTextDocument: (...a: unknown[]) => showTextDocument(...a),
    createWebviewPanel: () => ({
      title: '',
      webview: {
        html: '',
        cspSource: 'vscode-resource:',
        postMessage: vi.fn(),
        onDidReceiveMessage: (cb: (m: unknown) => void) => {
          onMessage = cb;
        },
      },
      onDidDispose: () => undefined,
      reveal: () => undefined,
      dispose: () => undefined,
    }),
  },
}));

const { ChallengePanel } = await import('../../src/ui/ChallengePanel');

const challenge = (id: string, file: string): Challenge => ({
  id,
  request: {
    file,
    range: { startLine: 1, endLine: 2 },
    symbol: id,
    signature: `def ${id}():`,
    spec: 's',
    testCommand: 'pytest',
    testFiles: [],
    language: 'python',
    concepts: [],
    difficulty: 2,
  },
  status: 'active',
  file: { absPath: file, workspaceFolder: '/ws' },
  testFiles: [],
  range: { startLine: 1, endLine: 2 },
  createdAt: 0,
  updatedAt: 0,
  attempts: 0,
});

describe('ChallengePanel offers', () => {
  it('forwards Accept / Skip / Snooze for a pending challenge only', () => {
    const answers: [string, string][] = [];
    const panel = new ChallengePanel((id, answer) => answers.push([id, answer]));
    const c: Challenge = { ...challenge('p', '/ws/p.py'), status: 'pending' };
    panel.show(c);
    onMessage?.({ type: 'acceptOffer' });
    onMessage?.({ type: 'skipOffer' });
    onMessage?.({ type: 'snoozeOffer' });
    c.status = 'active';
    panel.update(c);
    onMessage?.({ type: 'acceptOffer' });
    expect(answers).toEqual([['p', 'accept'], ['p', 'skip'], ['p', 'snooze']]);
  });
});

describe('ChallengePanel (regression)', () => {
  it('buttons keep acting on the shown challenge when another challenge updates', () => {
    const panel = new ChallengePanel();
    const a = challenge('a', '/ws/a.py');
    panel.show(a);
    a.status = 'passed';
    panel.update(a);
    // A new challenge is offered (pending) while A's panel is still open.
    panel.update({ ...challenge('b', '/ws/b.py'), status: 'pending' });

    onMessage?.({ type: 'openFile', file: '/ws/a.py' });
    expect(showTextDocument).toHaveBeenCalledOnce();
    expect(showTextDocument.mock.calls[0]?.[0]).toEqual({ fsPath: '/ws/a.py' });

    onMessage?.({ type: 'giveUp' });
    expect(executeCommand).toHaveBeenCalledWith('diby.giveUp', 'a');
  });
});
