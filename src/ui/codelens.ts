/** CodeLens above the active challenge's function. Thin vscode adapter. */
import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { Challenge } from '../types';

export class ChallengeCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  private challenge: { id: string; uri: vscode.Uri; line: number; running: boolean } | undefined;

  /** Point the lenses at a challenge (or undefined to remove them). */
  set(challenge: Challenge | undefined, uri?: vscode.Uri): void {
    this.challenge =
      challenge && uri
        ? { id: challenge.id, uri, line: challenge.range.startLine - 1, running: !!challenge.testsRunning }
        : undefined;
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const c = this.challenge;
    if (!c || document.uri.toString() !== c.uri.toString()) return [];
    const line = Math.min(Math.max(0, c.line), Math.max(0, document.lineCount - 1));
    const range = new vscode.Range(line, 0, line, 0);
    return [
      new vscode.CodeLens(range, {
        title: c.running ? '$(sync~spin) Running tests...' : '$(play) Run tests',
        command: COMMANDS.runTests,
        arguments: [c.id],
      }),
      new vscode.CodeLens(range, { title: '$(flag) Give up', command: COMMANDS.giveUp, arguments: [c.id] }),
      new vscode.CodeLens(range, { title: '$(book) Show challenge', command: COMMANDS.showPanel, arguments: [c.id] }),
    ];
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
