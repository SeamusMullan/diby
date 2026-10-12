/** Status bar items: active-challenge progress and idle mode indicator. Thin vscode adapter. */
import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { Challenge } from '../types';
import type { PracticeStats } from '../core/stats';
import { formatStats } from './statsText';

export class DibyStatusBar implements vscode.Disposable {
  private readonly active = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly idle = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  private readonly subscription: vscode.Disposable;

  /** `getStats` is read whenever the idle item re-renders (startup, mode change, challenge cleared). */
  constructor(private readonly getStats?: () => PracticeStats) {
    this.idle.command = COMMANDS.setMode;
    this.subscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('diby.mode')) this.renderIdle();
    });
    this.renderIdle();
  }

  private renderIdle(): void {
    const mode = vscode.workspace.getConfiguration('diby').get<string>('mode', 'steady');
    const stats = this.getStats?.();
    const streak = stats && stats.streakDays > 0 ? ` $(flame)${stats.streakDays}` : '';
    this.idle.text = `$(mortar-board) Diby: ${mode}${streak}`;
    const hint = 'Click to change how often agents may hand you functions';
    this.idle.tooltip = stats ? `${formatStats(stats).join('\n')}\n\n${hint}` : `Diby: ${hint.toLowerCase()}`;
    if (this.active.text) this.idle.hide();
    else this.idle.show();
  }

  /** Show a pending offer until it is answered (cleared by `set`). Clicking reopens it. */
  setOffer(challenge: Challenge): void {
    this.active.text = `$(bell-dot) Diby: implement ${challenge.request.symbol}?`;
    this.active.tooltip = 'An agent offered you a function to implement. Click to see the offer.';
    this.active.command = { title: 'Show offer', command: COMMANDS.showOffer };
    this.active.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.active.show();
    this.idle.hide();
  }

  /** Show progress for the active challenge, or hide with undefined. */
  set(challenge: Challenge | undefined): void {
    this.active.backgroundColor = undefined;
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
