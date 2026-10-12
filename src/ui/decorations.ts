/** Highlights the delegated function in visible editors. Thin vscode adapter. */
import * as vscode from 'vscode';
import type { LineRange } from '../types';

export class RegionDecorations implements vscode.Disposable {
  private readonly type = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('focusBorder'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  private target: { uri: vscode.Uri; range: LineRange } | undefined;

  /** Set (or clear with undefined) the highlighted region and apply it to visible editors. */
  set(target: { uri: vscode.Uri; range: LineRange } | undefined): void {
    this.target = target;
    this.apply();
  }

  /** Re-apply to all visible editors (call after range or visibility changes). */
  apply(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const t = this.target;
      if (t && editor.document.uri.toString() === t.uri.toString()) {
        const last = Math.max(0, Math.min(t.range.endLine, editor.document.lineCount) - 1);
        const first = Math.min(Math.max(0, t.range.startLine - 1), last);
        editor.setDecorations(this.type, [new vscode.Range(first, 0, last, 0)]);
      } else {
        editor.setDecorations(this.type, []);
      }
    }
  }

  dispose(): void {
    this.type.dispose();
  }
}
