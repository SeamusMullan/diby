/**
 * Reads `diby.*` settings. Thin VS Code-facing helper owned by the INTEGRATOR.
 */
import * as vscode from 'vscode';
import type { DibyMode, DibySettings, Difficulty, OfferStyle } from './types';

const MODES: readonly DibyMode[] = ['off', 'checkup', 'steady', 'learn'];
const OFFER_STYLES: readonly OfferStyle[] = ['modal', 'panel', 'notification'];

function clampDifficulty(n: unknown): Difficulty {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 5;
  return Math.min(5, Math.max(1, v)) as Difficulty;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
}

/** Snapshot of current settings. Call on every use; settings can change at any time. */
export function readSettings(): DibySettings {
  const c = vscode.workspace.getConfiguration('diby');
  const mode = c.get<string>('mode', 'steady');
  return {
    mode: (MODES as readonly string[]).includes(mode) ? (mode as DibyMode) : 'steady',
    focusConcepts: stringArray(c.get('focusConcepts')),
    avoidConcepts: stringArray(c.get('avoidConcepts')),
    maxDifficulty: clampDifficulty(c.get('maxDifficulty')),
    testTimeoutSec: Math.min(600, Math.max(5, c.get<number>('testTimeoutSec', 60))),
    askForReflection: c.get<boolean>('askForReflection', true),
  };
}

/** `diby.offerStyle`, falling back to `modal` for unknown values. */
export function readOfferStyle(): OfferStyle {
  const style = vscode.workspace.getConfiguration('diby').get<string>('offerStyle', 'modal');
  return (OFFER_STYLES as readonly string[]).includes(style) ? (style as OfferStyle) : 'modal';
}

/** Update `diby.mode` globally. */
export async function setMode(mode: DibyMode): Promise<void> {
  await vscode.workspace.getConfiguration('diby').update('mode', mode, vscode.ConfigurationTarget.Global);
}

export const MODE_LABELS: Readonly<Record<DibyMode, string>> = {
  off: 'Off — agents always write the code',
  checkup: 'Check-up — at most one harder challenge a day',
  steady: 'Steady — about one challenge an hour',
  learn: 'Learn — accept most suitable functions',
};
