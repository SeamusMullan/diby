/**
 * Turns `editor.inlineSuggest.enabled` off while a challenge is active (diby.disableInlineSuggestions)
 * and restores it afterwards. Thin vscode adapter; the scope choice is pure (`winningScope`).
 *
 * The original value is recorded in globalState before changing anything, so if VS Code exits
 * mid-challenge the next activation puts it back.
 */
import * as vscode from 'vscode';

const SECTION = 'editor';
const KEY = 'inlineSuggest.enabled';
const RESTORE_STATE_KEY = 'diby.inlineSuggestRestore.v1';

export type SettingScope = 'global' | 'workspace' | 'workspaceFolder';

export interface ScopedValues {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

/** The most specific scope that sets a value, i.e. the one VS Code uses. Global if none does. */
export function winningScope(values: ScopedValues | undefined): SettingScope {
  if (values?.workspaceFolderValue !== undefined) return 'workspaceFolder';
  if (values?.workspaceValue !== undefined) return 'workspace';
  return 'global';
}

interface RestoreRecord {
  scope: SettingScope;
  /** Value at that scope before Diby changed it; undefined means "not set". */
  previous: boolean | undefined;
  /** Resource the setting was read for (needed for the workspaceFolder scope). */
  uri?: string;
  /** Extension host that made the change. globalState is shared by all windows. */
  pid: number;
}

/** True if `pid` is a running process. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const TARGETS: Readonly<Record<SettingScope, vscode.ConfigurationTarget>> = {
  global: vscode.ConfigurationTarget.Global,
  workspace: vscode.ConfigurationTarget.Workspace,
  workspaceFolder: vscode.ConfigurationTarget.WorkspaceFolder,
};

const valueAt = (values: ScopedValues | undefined, scope: SettingScope): unknown =>
  scope === 'global' ? values?.globalValue : scope === 'workspace' ? values?.workspaceValue : values?.workspaceFolderValue;

export class InlineSuggestGuard {
  constructor(
    private readonly state: vscode.Memento,
    private readonly log: (message: string) => void = () => {},
  ) {}

  /** Disable inline suggestions for `uri`'s scope, unless the setting is off or they are already off. */
  async suppress(uri: vscode.Uri): Promise<void> {
    if (!vscode.workspace.getConfiguration('diby').get<boolean>('disableInlineSuggestions', true)) return;
    // Another window already turned them off (and will restore them).
    if (this.state.get<RestoreRecord>(RESTORE_STATE_KEY)) return;
    const config = vscode.workspace.getConfiguration(SECTION, uri);
    if (config.get<boolean>(KEY, true) === false) return;
    const values = config.inspect<boolean>(KEY);
    const scope = winningScope(values);
    const previous = valueAt(values, scope);
    const record: RestoreRecord = {
      scope,
      previous: typeof previous === 'boolean' ? previous : undefined,
      uri: uri.toString(),
      pid: process.pid,
    };
    try {
      await this.state.update(RESTORE_STATE_KEY, record);
      await config.update(KEY, false, TARGETS[scope]);
    } catch (err) {
      this.log(`could not disable inline suggestions: ${String(err)}`);
      await this.state.update(RESTORE_STATE_KEY, undefined);
    }
  }

  /** On activation: undo a change left behind by a window that exited mid-challenge. */
  async recover(): Promise<void> {
    const record = this.state.get<RestoreRecord>(RESTORE_STATE_KEY);
    if (record && (record.pid === process.pid || !isAlive(record.pid))) await this.undo(record);
  }

  /** Put back whatever this window's `suppress` changed. */
  async restore(): Promise<void> {
    const record = this.state.get<RestoreRecord>(RESTORE_STATE_KEY);
    if (record?.pid === process.pid) await this.undo(record);
  }

  private async undo(record: RestoreRecord): Promise<void> {
    try {
      const uri = record.uri ? vscode.Uri.parse(record.uri) : undefined;
      const config = vscode.workspace.getConfiguration(SECTION, uri);
      // Only undo our own change: if the user re-enabled it meanwhile, leave their choice alone.
      if (valueAt(config.inspect<boolean>(KEY), record.scope) === false) {
        await config.update(KEY, record.previous, TARGETS[record.scope]);
      }
    } catch (err) {
      this.log(`could not restore inline suggestions: ${String(err)}`);
    }
    await this.state.update(RESTORE_STATE_KEY, undefined);
  }
}
