/**
 * MODULE connect — "Diby: Connect Agents" command (VS Code-facing, thin).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { writeAgentInstructions } from './agentsMd';
import { writeClaudeCodeConfig } from './claudeCode';
import { codexConfigPath, writeCodexConfig } from './codex';
import type { ConnectResult } from './types';

export interface ConnectDeps {
  /** Stable absolute shim path (~/.diby/bin/mcp-shim.js) for Claude Code / Codex configs. */
  getShimPath(): string;
  log(message: string): void;
}

type TargetId = 'claude-code' | 'codex' | 'instructions';
interface TargetItem extends vscode.QuickPickItem {
  id?: TargetId;
}

function onPath(cmd: string): boolean {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, cmd + ext), fs.constants.X_OK);
        return true;
      } catch {
        /* keep looking */
      }
    }
  }
  return false;
}

function detectClaude(): boolean {
  return onPath('claude') || vscode.extensions.getExtension('anthropic.claude-code') !== undefined;
}

function detectCodex(): boolean {
  return (
    onPath('codex') ||
    fs.existsSync(path.dirname(codexConfigPath())) ||
    vscode.extensions.getExtension('openai.chatgpt') !== undefined
  );
}

function detectCopilot(): boolean {
  return vscode.extensions.getExtension('GitHub.copilot-chat') !== undefined;
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage('Diby: open a folder first, then run "Diby: Connect Agents".');
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  const picked = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
    { title: 'Diby: choose the workspace folder to connect', placeHolder: 'Workspace folder' },
  );
  return picked?.folder;
}

async function runConnect(deps: ConnectDeps): Promise<void> {
  const folder = await pickFolder();
  if (!folder) return;

  const claude = detectClaude();
  const codex = detectCodex();
  const copilot = detectCopilot();
  const items: TargetItem[] = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      description: '.mcp.json in this folder',
      detail: claude ? 'Detected' : 'Not detected',
      picked: claude,
    },
    {
      id: 'codex',
      label: 'Codex',
      description: `${codexConfigPath().replace(os.homedir(), '~')} (global)`,
      detail: codex ? 'Detected' : 'Not detected',
      picked: codex,
    },
    {
      id: 'instructions',
      label: 'Agent instructions',
      description: 'AGENTS.md section + @AGENTS.md in CLAUDE.md',
      detail: 'Teaches agents when and how to delegate. Recommended.',
      picked: true,
    },
    { label: 'GitHub Copilot', kind: vscode.QuickPickItemKind.Separator },
    {
      label: 'Copilot agent mode',
      description: 'automatic',
      detail: copilot ? 'Detected. Diby registers itself with VS Code, nothing to write.' : 'Registers itself with VS Code if Copilot is installed.',
    },
  ];
  const picks = await vscode.window.showQuickPick(items, {
    title: 'Diby: Connect Agents',
    placeHolder: 'Choose what to set up',
    canPickMany: true,
  });
  const chosen = new Set((picks ?? []).map((p) => p.id).filter((id): id is TargetId => id !== undefined));
  if (chosen.size === 0) return;

  const shim = deps.getShimPath();
  const results: ConnectResult[] = [];
  const attempt = async (label: string, fn: () => Promise<ConnectResult | ConnectResult[]>): Promise<void> => {
    try {
      const r = await fn();
      results.push(...(Array.isArray(r) ? r : [r]));
    } catch (err) {
      deps.log(`connect ${label} failed: ${String(err)}`);
      void vscode.window.showErrorMessage(`Diby: ${label} failed. ${(err as Error).message}`);
    }
  };

  if (chosen.has('claude-code')) await attempt('Claude Code', () => writeClaudeCodeConfig(folder.uri.fsPath, shim));
  if (chosen.has('codex')) {
    const file = codexConfigPath();
    const answer = await vscode.window.showWarningMessage(
      'Diby wants to edit your global Codex config.',
      {
        modal: true,
        detail: `It will add or update a [mcp_servers.diby] section in ${file}. Everything else in the file is left untouched.`,
      },
      'Edit config',
    );
    if (answer === 'Edit config') await attempt('Codex', () => writeCodexConfig(shim));
  }
  if (chosen.has('instructions')) await attempt('Agent instructions', () => writeAgentInstructions(folder.uri.fsPath));

  for (const r of results) deps.log(`connect ${r.target}: ${r.message}${r.path ? ` (${r.path})` : ''}`);
  if (results.length === 0) return;
  const changed = results.filter((r) => r.changed && r.path);
  const summary = results.map((r) => r.message).join('. ');
  if (changed.length === 0) {
    void vscode.window.showInformationMessage(`Diby: everything was already set up. ${summary}`);
    return;
  }
  const open = await vscode.window.showInformationMessage(`Diby: ${summary}. Restart your agent to pick up the change.`, 'Open files');
  if (open === 'Open files') {
    for (const r of changed) {
      if (r.path) await vscode.window.showTextDocument(vscode.Uri.file(r.path), { preview: false, preserveFocus: true });
    }
  }
}

/** Registers `diby.connectAgents`. */
export function registerConnectCommand(context: vscode.ExtensionContext, deps: ConnectDeps): vscode.Disposable {
  const d = vscode.commands.registerCommand(COMMANDS.connectAgents, () =>
    runConnect(deps).catch((err) => {
      deps.log(`connectAgents error: ${String(err)}`);
      void vscode.window.showErrorMessage(`Diby: Connect Agents failed. ${(err as Error).message}`);
    }),
  );
  context.subscriptions.push(d);
  return d;
}
