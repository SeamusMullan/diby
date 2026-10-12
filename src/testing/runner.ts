/**
 * MODULE languages — runs a test command via an adapter. Pure Node (child_process), no vscode.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_OUTPUT_BYTES } from '../constants';
import type { RawTestOutput, RunTestsFn } from '../types';

/** Collects a stream up to a size cap, noting truncation. */
class CappedBuffer {
  private chunks: string[] = [];
  private size = 0;
  private truncated = false;
  push(s: string): void {
    if (this.size >= MAX_OUTPUT_BYTES) {
      this.truncated = true;
      return;
    }
    const room = MAX_OUTPUT_BYTES - this.size;
    const part = s.length > room ? s.slice(0, room) : s;
    if (part.length < s.length) this.truncated = true;
    this.chunks.push(part);
    this.size += part.length;
  }
  toString(): string {
    return this.chunks.join('') + (this.truncated ? '\n[... output truncated ...]' : '');
  }
}

function killTree(pid: number | undefined, child: { kill(sig?: NodeJS.Signals): boolean }): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else if (pid !== undefined) {
      process.kill(-pid, 'SIGKILL');
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

export const runTests: RunTestsFn = async (opts) => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'diby-run-'));
  try {
    let interpreter: string | undefined;
    try {
      interpreter = await opts.adapter.resolveInterpreter?.(opts.workspaceFolder);
    } catch {
      interpreter = undefined;
    }
    const instr = opts.adapter.instrumentTestCommand(opts.command, tmpDir, {
      workspaceFolder: opts.workspaceFolder,
      cwd: opts.cwd,
      ...(interpreter ? { interpreter } : {}),
    });

    const startedAt = Date.now();
    const out = new CappedBuffer();
    const err = new CappedBuffer();
    let timedOut = false;
    let exitCode: number | null = null;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(instr.cmd, {
          shell: true,
          cwd: opts.cwd,
          env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...opts.env, ...instr.env },
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        err.push(`Failed to start test command: ${(e as Error).message}\n`);
        resolve();
        return;
      }
      const kill = () => killTree(child.pid, child);
      const onAbort = () => kill();
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, Math.max(1, opts.timeoutSec) * 1000);
      if (opts.signal) {
        if (opts.signal.aborted) kill();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      child.stdout?.setEncoding('utf8').on('data', (d: string) => out.push(d));
      child.stderr?.setEncoding('utf8').on('data', (d: string) => err.push(d));
      child.on('error', (e) => {
        err.push(`Failed to run test command: ${e.message}\n`);
        finish();
      });
      child.on('close', (code) => {
        exitCode = code;
        finish();
      });
    });

    let reportXml: string | undefined;
    if (instr.reportPath) {
      try {
        reportXml = await readFile(instr.reportPath, 'utf8');
      } catch {
        reportXml = undefined;
      }
    }
    const raw: RawTestOutput = {
      command: instr.cmd,
      cwd: opts.cwd,
      stdout: out.toString(),
      stderr: err.toString(),
      exitCode,
      timedOut,
      startedAt,
      durationMs: Date.now() - startedAt,
      ...(reportXml !== undefined ? { reportXml } : {}),
    };
    const result = opts.adapter.parseResults(raw);
    if (timedOut) result.stderr += `\nTimed out after ${opts.timeoutSec}s.`;
    return result;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
};
