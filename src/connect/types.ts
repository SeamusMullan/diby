/** Outcome of one connect step, shown in the summary notification. */
export interface ConnectResult {
  target: 'claude-code' | 'codex' | 'copilot' | 'agents-md' | 'claude-md';
  /** File that was (or would have been) written. */
  path?: string;
  /** False when the file already had the desired content. */
  changed: boolean;
  message: string;
}
