/** The challenge webview panel. Thin vscode adapter around the pure renderers in panelHtml.ts. */
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { Challenge, OfferAnswer } from '../types';
import { renderPanelBody, renderPanelHtml } from './panelHtml';

interface PanelMessage {
  type?: string;
  file?: string;
}

const OFFER_MESSAGES: Readonly<Record<string, OfferAnswer>> = {
  acceptOffer: 'accept',
  skipOffer: 'skip',
  snoozeOffer: 'snooze',
};

export class ChallengePanel implements vscode.Disposable {
  /** `onOfferAnswer` receives Accept / Skip / Snooze clicks on a pending challenge. */
  constructor(private readonly onOfferAnswer?: (id: string, answer: OfferAnswer) => void) {}

  private panel: vscode.WebviewPanel | undefined;
  private shownId: string | undefined;
  private latest: Challenge | undefined;

  /** Create or reveal the panel and render `challenge`. */
  show(challenge: Challenge, preserveFocus = false): void {
    this.latest = challenge;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'diby.challenge',
        'Diby challenge',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus },
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.panel.webview.onDidReceiveMessage((m: PanelMessage) => this.onMessage(m));
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.shownId = undefined;
      });
    } else {
      this.panel.reveal(undefined, preserveFocus);
    }
    this.panel.title = `Diby: ${challenge.request.symbol}`;
    if (this.shownId !== challenge.id) {
      this.shownId = challenge.id;
      this.panel.webview.html = renderPanelHtml(challenge, randomBytes(16).toString('base64'), this.panel.webview.cspSource);
    } else {
      void this.panel.webview.postMessage({ type: 'render', html: renderPanelBody(challenge) });
    }
  }

  /** Re-render if the panel is open and showing this challenge. */
  update(challenge: Challenge): void {
    // Only track the challenge the panel is showing: the buttons/links act on `latest`, so letting an
    // unrelated (e.g. newly pending) challenge replace it would make them act on the wrong challenge.
    if (this.panel && this.shownId === challenge.id) {
      this.latest = challenge;
      void this.panel.webview.postMessage({ type: 'render', html: renderPanelBody(challenge) });
    }
  }

  private onMessage(message: PanelMessage): void {
    const c = this.latest;
    if (!c || typeof message !== 'object' || message === null) return;
    const answer = typeof message.type === 'string' ? OFFER_MESSAGES[message.type] : undefined;
    if (answer) {
      if (c.status === 'pending') this.onOfferAnswer?.(c.id, answer);
      return;
    }
    switch (message.type) {
      case 'runTests':
        void vscode.commands.executeCommand(COMMANDS.runTests, c.id);
        break;
      case 'giveUp':
        void vscode.commands.executeCommand(COMMANDS.giveUp, c.id);
        break;
      case 'openFile': {
        // Only files belonging to this challenge may be opened from the webview.
        const allowed = [c.file?.absPath, ...c.testFiles].filter((p): p is string => !!p).map((p) => path.normalize(p));
        const wanted = typeof message.file === 'string' ? path.normalize(message.file) : undefined;
        if (!wanted || !allowed.includes(wanted)) return;
        const line = wanted === allowed[0] ? Math.max(0, c.range.startLine - 1) : 0;
        void vscode.window.showTextDocument(vscode.Uri.file(wanted), {
          selection: new vscode.Range(line, 0, line, 0),
          viewColumn: vscode.ViewColumn.One,
        });
        break;
      }
    }
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
