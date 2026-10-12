/**
 * MODULE core-ui — VS Code implementation of WorkspaceAccess.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ResolvedFile, WorkspaceAccess } from '../types';

const norm = (p: string): string => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p));

function folderContaining(abs: string): string | undefined {
  let best: string | undefined;
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const root = f.uri.fsPath;
    const rel = path.relative(norm(root), norm(abs));
    if (!rel.startsWith('..') && !path.isAbsolute(rel) && (!best || root.length > best.length)) best = root;
  }
  return best;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Resolve agent-supplied paths (absolute or relative) to files inside open workspace folders; read live text. */
export function createWorkspaceAccess(): WorkspaceAccess {
  return {
    resolve(file: string, cwd?: string): ResolvedFile | undefined {
      const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      const candidates = path.isAbsolute(file)
        ? [file]
        : [...(cwd && path.isAbsolute(cwd) ? [path.resolve(cwd, file)] : []), ...folders.map((f) => path.resolve(f, file))];
      for (const candidate of candidates) {
        const workspaceFolder = folderContaining(candidate);
        if (workspaceFolder && isFile(candidate)) return { absPath: path.normalize(candidate), workspaceFolder };
      }
      return undefined;
    },

    async readText(absPath: string): Promise<string> {
      const open = vscode.workspace.textDocuments.find((d) => norm(d.uri.fsPath) === norm(absPath));
      if (open) return open.getText();
      return fs.promises.readFile(absPath, 'utf8');
    },
  };
}
