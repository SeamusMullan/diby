/** Status bar items: active-challenge progress and idle mode indicator. Thin vscode adapter. */
import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { Challenge } from '../types';

export class DibyStatusBar implements vscode.Disposable {
  private readonly active = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly idle = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  private readonly subscription: vscode.Disposable;

  constructor() {
    this.idle.command = COMMANDS.setMode;
    this.idle.tooltip = 'Diby: click to change how often agents may hand you functions';
    this.subscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('diby.mode')) this.renderIdle();
    });
    this.renderIdle();
  }

  private renderIdle(): void {
    const mode = vscode.workspace.getConfiguration('diby').get<string>('mode', 'steady');
    this.idle.text = `$(mortar-board) Diby: ${mode}`;
    if (this.active.text) this.idle.hide();
    else this.idle.show();
  }

  /** Show progress for the active challenge, or hide with undefined. */
  set(challenge: Challenge | undefined): void {
    if (!challenge) {
      this.active.hide();
      this.active.text = '';
      this.renderIdle();
      return;
    }
    const run = challenge.lastRun;
    const progress = challenge.testsRunning
      ? '$(sync~spin)'
      : run && run.total > 0
        ? `${run.passed}/${run.total}`
        : 'not run';
    this.active.text = `$(mortar-board) ${challenge.request.symbol} ${progress}`;
    this.active.tooltip = 'Diby challenge: click to open the panel';
    this.active.command = { title: 'Show challenge', command: COMMANDS.showPanel, arguments: [challenge.id] };
    this.active.show();
    this.idle.hide();
  }

  dispose(): void {
    this.subscription.dispose();
    this.active.dispose();
    this.idle.dispose();
  }
}
