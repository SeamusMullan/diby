/**
 * MODULE core-ui — VS Code implementation of ChallengeUi (composes ChallengePanel, codelens,
 * statusBar, decorations). Thin: no business logic, just rendering + user prompts.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readOfferStyle } from '../config';
import { COMMANDS, CONTEXT_CHALLENGE_ACTIVE, CONTEXT_OFFER_PENDING, OFFER_TIMEOUT_MS, REFLECTION_TIMEOUT_MS } from '../constants';
import type { Challenge, ChallengeUi, LanguageAdapter, LineRange, OfferAnswer } from '../types';
import type { PracticeStats } from '../core/stats';
import { ChallengePanel } from './ChallengePanel';
import { ChallengeCodeLensProvider } from './codelens';
import { RegionDecorations } from './decorations';
import { DibyStatusBar } from './statusBar';
import { offerDetail, offerMessage } from './offerText';
import { extractRange, shiftRangeAll } from './textRange';

const ACCEPT = 'Accept';
const SKIP = 'Skip';
const SNOOZE = 'Snooze for session';

const answerOf = (choice: string | undefined): OfferAnswer | undefined =>
  choice === ACCEPT ? 'accept' : choice === SKIP ? 'skip' : choice === SNOOZE ? 'snooze' : undefined;

interface PendingOffer {
  challenge: Challenge;
  settle(answer: OfferAnswer): void;
}

function uriOf(challenge: Challenge): vscode.Uri {
  return vscode.Uri.file(challenge.file?.absPath ?? challenge.request.file);
}

/** Build the VS Code UI. Dispose it when the extension deactivates. `getStats` feeds the idle status bar item. */
export function createChallengeUi(
  context: vscode.ExtensionContext,
  getStats?: () => PracticeStats,
): ChallengeUi & vscode.Disposable {
  let pendingOffer: PendingOffer | undefined;
  const panel = new ChallengePanel((id, answer) => {
    if (pendingOffer?.challenge.id === id) pendingOffer.settle(answer);
  });
  const lenses = new ChallengeCodeLensProvider();
  const decorations = new RegionDecorations();
  const statusBar = new DibyStatusBar(getStats);
  const diagnostics = vscode.languages.createDiagnosticCollection('diby');
  let tracked: Challenge | undefined;

  const applyRegion = (): void => {
    if (!tracked) return;
    decorations.set({ uri: uriOf(tracked), range: tracked.range });
    lenses.set(tracked, uriOf(tracked));
  };

  const applyDiagnostics = (c: Challenge): void => {
    diagnostics.clear();
    const run = c.lastRun;
    if (!run || c.status !== 'active') return;
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const d of run.diagnostics) {
      const abs = path.isAbsolute(d.file) ? d.file : path.resolve(c.testCwd ?? c.file?.workspaceFolder ?? '', d.file);
      const line = Math.max(0, d.line - 1);
      const col = Math.max(0, (d.column ?? 1) - 1);
      const diag = new vscode.Diagnostic(
        new vscode.Range(line, col, line, d.column ? col + 1 : 1 << 20),
        d.message,
        d.severity === 'error'
          ? vscode.DiagnosticSeverity.Error
          : d.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information,
      );
      diag.source = 'Diby';
      byFile.set(abs, [...(byFile.get(abs) ?? []), diag]);
    }
    for (const [file, list] of byFile) diagnostics.set(vscode.Uri.file(file), list);
  };

  const subscriptions: vscode.Disposable[] = [
    vscode.commands.registerCommand(COMMANDS.showOffer, () => {
      if (pendingOffer) panel.show(pendingOffer.challenge);
    }),
    panel,
    lenses,
    decorations,
    statusBar,
    diagnostics,
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, lenses),
    vscode.window.onDidChangeVisibleTextEditors(() => decorations.apply()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!tracked || e.contentChanges.length === 0) return;
      if (e.document.uri.toString() !== uriOf(tracked).toString()) return;
      tracked.range = shiftRangeAll(
        tracked.range,
        e.contentChanges.map((c) => ({
          startLine: c.range.start.line,
          endLine: c.range.end.line,
          endCharacter: c.range.end.character,
          text: c.text,
        })),
      );
      applyRegion();
    }),
  ];
  context.subscriptions.push(...subscriptions);

  return {
    offer(challenge: Challenge): Promise<OfferAnswer> {
      return new Promise<OfferAnswer>((resolve) => {
        let settled = false;
        const settle = (answer: OfferAnswer): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pendingOffer = undefined;
          statusBar.set(undefined);
          void vscode.commands.executeCommand('setContext', CONTEXT_OFFER_PENDING, false);
          resolve(answer);
        };
        const timer = setTimeout(() => settle('timeout'), OFFER_TIMEOUT_MS);
        // A modal or notification can't be closed programmatically, so it may be answered after the
        // timeout. Say so rather than ignoring the click.
        const late = (choice: string | undefined): void => {
          const answer = answerOf(choice);
          if (!settled) {
            if (answer) settle(answer);
          } else if (answer === 'accept') {
            void vscode.window.showInformationMessage(`Diby: the offer for \`${challenge.request.symbol}\` expired, so the agent is writing it.`);
          }
        };

        pendingOffer = { challenge, settle };
        statusBar.setOffer(challenge);
        void vscode.commands.executeCommand('setContext', CONTEXT_OFFER_PENDING, true);

        const text = offerMessage(challenge.request);
        const style = readOfferStyle();
        if (style === 'modal') {
          // Closing the dialog (Esc / Cancel) counts as Skip.
          void Promise.resolve(
            vscode.window.showInformationMessage(text, { modal: true, detail: offerDetail(challenge.request) }, ACCEPT, SKIP, SNOOZE),
          ).then((choice) => late(choice ?? SKIP), () => late(SKIP));
        } else if (style === 'panel') {
          panel.show(challenge);
        } else {
          // An auto-hidden toast never resolves; one closed with X resolves undefined. Either way
          // the status bar item stays until an answer or the timeout.
          void Promise.resolve(vscode.window.showInformationMessage(text, ACCEPT, SKIP, SNOOZE)).then(late, () => undefined);
        }
      });
    },

    async show(challenge: Challenge): Promise<void> {
      tracked = challenge;
      void vscode.commands.executeCommand('setContext', CONTEXT_CHALLENGE_ACTIVE, true);
      const doc = await vscode.workspace.openTextDocument(uriOf(challenge));
      const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
      const line = Math.max(0, Math.min(challenge.range.startLine - 1, doc.lineCount - 1));
      const target = new vscode.Range(line, 0, line, 0);
      editor.selection = new vscode.Selection(target.start, target.end);
      editor.revealRange(target, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      applyRegion();
      statusBar.set(challenge);
      panel.show(challenge, true);
    },

    refresh(challenge: Challenge): void {
      panel.update(challenge);
      if (tracked?.id === challenge.id && challenge.status === 'active') {
        statusBar.set(challenge);
        lenses.set(challenge, uriOf(challenge));
        applyDiagnostics(challenge);
      }
    },

    clear(challenge: Challenge): void {
      // E.g. the agent cancelled while the offer was open. The manager ignores this late answer.
      if (pendingOffer?.challenge.id === challenge.id) pendingOffer.settle('skip');
      if (tracked?.id !== challenge.id) return;
      tracked = undefined;
      decorations.set(undefined);
      lenses.set(undefined);
      statusBar.set(undefined);
      diagnostics.clear();
      void vscode.commands.executeCommand('setContext', CONTEXT_CHALLENGE_ACTIVE, false);
    },

    async reveal(challenge: Challenge): Promise<void> {
      panel.show(challenge);
    },

    async captureCode(challenge: Challenge, adapter: LanguageAdapter): Promise<{ code: string; range: LineRange }> {
      const doc = await vscode.workspace.openTextDocument(uriOf(challenge));
      const text = doc.getText();
      const located = adapter.locateSymbol?.(text, challenge.request.symbol, challenge.range) ?? challenge.range;
      return extractRange(text, located);
    },

    async saveFile(challenge: Challenge): Promise<void> {
      const paths = new Set([uriOf(challenge).fsPath, ...challenge.testFiles]);
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.isDirty && paths.has(doc.uri.fsPath)) await doc.save();
      }
    },

    async askReflection(challenge: Challenge): Promise<string | undefined> {
      const cancel = new vscode.CancellationTokenSource();
      const timer = setTimeout(() => cancel.cancel(), REFLECTION_TIMEOUT_MS);
      try {
        return await vscode.window.showInputBox(
          {
            title: `Diby: ${challenge.request.symbol} passed`,
            prompt: 'One line on what you learned or found tricky (optional, shared with the agent). Press Escape to skip.',
            placeHolder: 'e.g. forgot the empty-string case at first',
          },
          cancel.token,
        );
      } finally {
        clearTimeout(timer);
        cancel.dispose();
      }
    },

    async confirmGiveUp(challenge: Challenge): Promise<boolean> {
      const answer = await vscode.window.showWarningMessage(
        `Give up on \`${challenge.request.symbol}\`?`,
        { modal: true, detail: 'The agent will implement it instead. Your current code is sent along for context.' },
        'Give up',
      );
      return answer === 'Give up';
    },

    notify(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
      if (level === 'error') void vscode.window.showErrorMessage(message);
      else if (level === 'warning') void vscode.window.showWarningMessage(message);
      else void vscode.window.showInformationMessage(message);
    },

    dispose(): void {
      for (const d of subscriptions) d.dispose();
    },
  };
}
