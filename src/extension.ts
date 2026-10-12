/**
 * Diby extension entry point: wiring only. Owned by the INTEGRATOR.
 * Every module is reached through the contracts in src/types.ts (see ARCHITECTURE.md §Contracts).
 */
import * as vscode from 'vscode';
import * as path from 'node:path';

import { COMMANDS, DIBY_VERSION } from './constants';
import { MODE_LABELS, readSettings, setMode } from './config';
import { DelegateRequestSchema } from './schemas';
import type { BridgeServer, DibyMode, EndpointInfo, ToolHandlers } from './types';

// core-ui
import { ChallengeManager } from './core/ChallengeManager';
import { decide } from './core/policy';
import { MementoHistoryStore } from './core/history';
import { createChallengeUi } from './ui/challengeUi';
import { createWorkspaceAccess } from './ui/workspace';
// transport
import { startBridge } from './bridge/server';
import { ensureEndpointFile, normalizeWorkspacePath, removeEndpointFile, writeEndpointFile } from './bridge/endpointFile';
import { installShim } from './bridge/installShim';
// languages
import { createLanguageRegistry } from './languages';
import { resolvePythonInterpreter } from './languages/vscodeInterpreter';
import { runTests } from './testing/runner';
// connect
import { registerConnectCommand } from './connect/command';
import { registerCopilotMcpProvider } from './connect/copilot';

let teardown: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Diby', { log: true });
  context.subscriptions.push(output);
  const log = (message: string) => output.info(message);
  log(`Diby ${DIBY_VERSION} activating`);

  // --- core ---
  const ui = createChallengeUi(context);
  context.subscriptions.push(ui);
  const manager = new ChallengeManager({
    ui,
    workspace: createWorkspaceAccess(),
    history: new MementoHistoryStore(context.globalState),
    languages: createLanguageRegistry({
      python: {
        resolveInterpreter: resolvePythonInterpreter,
        disablePluginAutoload: () =>
          vscode.workspace.getConfiguration('diby').get<boolean>('python.disablePluginAutoload', false),
      },
    }),
    runTests,
    decide,
    getSettings: readSettings,
    log,
  });
  context.subscriptions.push(manager);

  // Settings are read fresh on every policy decision (getSettings: readSettings), so changes apply
  // immediately; here we only log them and react to `off` by withdrawing an unanswered offer.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('diby')) return;
      const s = readSettings();
      log(`settings changed: mode=${s.mode} maxDifficulty=${s.maxDifficulty} focus=[${s.focusConcepts.join(',')}] avoid=[${s.avoidConcepts.join(',')}]`);
      const open = manager.current();
      if (s.mode === 'off' && open?.status === 'pending') {
        void manager.cancel({ id: open.id, reason: 'Diby was switched off' }, {});
      }
    }),
  );

  // --- commands (CodeLens / panel pass the challenge id as first arg) ---
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.runTests, (id?: string) => manager.runTests(id)),
    vscode.commands.registerCommand(COMMANDS.giveUp, (id?: string) => manager.giveUp(id)),
    vscode.commands.registerCommand(COMMANDS.showPanel, (id?: string) => manager.showPanel(id)),
    vscode.commands.registerCommand(COMMANDS.snooze, () => manager.snooze()),
    vscode.commands.registerCommand(COMMANDS.setMode, pickMode),
    vscode.commands.registerCommand(COMMANDS.startDemoChallenge, (uri?: vscode.Uri) => startDemo(manager, uri)),
  );

  // --- transport: shim + bridge + endpoint files ---
  const bundledShim = context.asAbsolutePath(path.join('dist', 'mcp-shim.js'));
  let stableShim = bundledShim;
  try {
    stableShim = await installShim(bundledShim);
  } catch (err) {
    log(`installShim failed, using bundled shim path: ${String(err)}`);
  }

  const handlers: ToolHandlers = manager;
  let bridge: BridgeServer;
  try {
    bridge = await startBridge(handlers, { log });
  } catch (err) {
    // Without the bridge agents cannot reach Diby, but the demo challenge and commands still work.
    log(`bridge failed to start: ${String(err)}`);
    void vscode.window.showErrorMessage(`Diby: could not start the local agent bridge (${String(err)}). Agents will implement functions themselves.`);
    context.subscriptions.push(registerConnectCommand(context, { getShimPath: () => stableShim, log }));
    return;
  }

  const written = new Set<string>();
  let stopped = false;
  const endpointInfo = (ws: string): EndpointInfo => ({
    version: 1,
    port: bridge.port,
    token: bridge.token,
    pid: process.pid,
    workspace: ws,
    writtenAt: Date.now(),
    extensionVersion: DIBY_VERSION,
  });
  const syncEndpoints = async () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => normalizeWorkspacePath(f.uri.fsPath));
    for (const ws of folders) {
      await writeEndpointFile(endpointInfo(ws));
      written.add(ws);
    }
    for (const ws of [...written]) {
      if (!folders.includes(ws)) {
        await removeEndpointFile(ws, { pid: process.pid });
        written.delete(ws);
      }
    }
  };
  const syncSafely = () =>
    syncEndpoints().catch((err: unknown) => log(`could not write endpoint files: ${String(err)}`));
  await syncSafely();
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void syncSafely()));

  // Two windows on the same folder share one endpoint file. Whichever wrote last removes it on close, so
  // the survivor periodically (and on focus) re-claims files that went missing or belong to a dead pid.
  const reclaim = () => {
    if (stopped) return;
    for (const ws of written) {
      ensureEndpointFile(endpointInfo(ws))
        .then((wrote) => wrote && log(`re-claimed endpoint file for ${ws}`))
        .catch((err: unknown) => log(`could not re-claim endpoint file: ${String(err)}`));
    }
  };
  const reclaimTimer = setInterval(reclaim, 30_000);
  context.subscriptions.push(
    new vscode.Disposable(() => clearInterval(reclaimTimer)),
    vscode.window.onDidChangeWindowState((state) => state.focused && reclaim()),
  );

  // --- connect ---
  context.subscriptions.push(
    registerCopilotMcpProvider(context, bundledShim),
    registerConnectCommand(context, { getShimPath: () => stableShim, log }),
  );

  teardown = async () => {
    stopped = true;
    clearInterval(reclaimTimer);
    await Promise.allSettled([...written].map((ws) => removeEndpointFile(ws, { pid: process.pid })));
    // Cancel the open challenge and release in-flight diby_wait long-polls so agents get a final
    // status ("cancelled") instead of a dropped connection, then close the bridge.
    manager.dispose();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await bridge.close();
  };
  log('Diby activated');
  void maybeSuggestConnect(context);
}

export async function deactivate(): Promise<void> {
  await teardown?.();
  teardown = undefined;
}

async function pickMode(): Promise<void> {
  const current = readSettings().mode;
  const items = (Object.keys(MODE_LABELS) as DibyMode[]).map((mode) => ({
    label: mode === current ? `$(check) ${mode}` : mode,
    description: MODE_LABELS[mode],
    mode,
  }));
  const picked = await vscode.window.showQuickPick(items, { title: 'Diby mode' });
  if (picked) await setMode(picked.mode);
}

/** Load a DelegateRequest JSON (e.g. examples/python-sample/.diby/demo-challenge.json) and start it, bypassing policy. */
async function startDemo(manager: ChallengeManager, uri?: vscode.Uri): Promise<void> {
  let target = uri instanceof vscode.Uri ? uri : undefined;
  if (!target) {
    const found = await vscode.workspace.findFiles('**/.diby/demo-challenge.json', '**/node_modules/**', 10);
    target = (
      await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Diby challenge (DelegateRequest JSON)': ['json'] },
        defaultUri: found[0] ?? (await defaultExamplesUri()),
        openLabel: 'Start challenge',
        title: 'Diby: pick a challenge JSON (a diby_delegate request)',
      })
    )?.[0];
  }
  if (!target) return;
  try {
    const raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(target))) as unknown;
    const req = DelegateRequestSchema.parse(raw);
    // Relative paths in the demo file resolve against the JSON file's project dir: the parent of
    // `.diby/` when the file lives there, else the JSON file's own directory.
    const jsonDir = path.dirname(target.fsPath);
    const cwd = path.basename(jsonDir) === '.diby' ? path.dirname(jsonDir) : jsonDir;
    const res = await manager.startDemo(req, { cwd });
    if (res.status === 'declined_by_policy') void vscode.window.showWarningMessage(`Diby: ${res.message}`);
  } catch (err) {
    void vscode.window.showErrorMessage(`Diby: could not start demo challenge: ${String(err)}`);
  }
}

/** `<folder>/examples` if it exists in any workspace folder, else the first folder. */
async function defaultExamplesUri(): Promise<vscode.Uri | undefined> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const examples = vscode.Uri.joinPath(folder.uri, 'examples');
    try {
      await vscode.workspace.fs.stat(examples);
      return examples;
    } catch {
      /* try next folder */
    }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

const CONNECT_HINT_KEY = 'diby.connectHintShown.v1';

/** One-time nudge towards "Diby: Connect Agents" (ARCHITECTURE.md §7). */
async function maybeSuggestConnect(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(CONNECT_HINT_KEY)) return;
  await context.globalState.update(CONNECT_HINT_KEY, true);
  const choice = await vscode.window.showInformationMessage(
    'Diby is ready. Connect your coding agents (Claude Code, Codex, Copilot) so they can hand you functions to implement?',
    'Connect Agents',
    'Try a demo',
  );
  if (choice === 'Connect Agents') await vscode.commands.executeCommand(COMMANDS.connectAgents);
  else if (choice === 'Try a demo') await vscode.commands.executeCommand(COMMANDS.startDemoChallenge);
}
