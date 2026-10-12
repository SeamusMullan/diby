/**
 * HTML for the challenge webview. PURE (no vscode): takes a Challenge snapshot, returns strings.
 * All dynamic text is escaped; the only script is nonce-protected and only posts messages.
 */
import { basename } from 'node:path';
import type { Challenge, TestCaseResult } from '../types';
import { escapeHtml, renderMarkdownLite } from './markdownLite';

const STATUS_LABEL: Record<Challenge['status'], string> = {
  pending: 'Waiting for you to accept',
  active: 'In progress',
  declined_by_policy: 'Declined',
  declined: 'Skipped',
  passed: 'Passed',
  gave_up: 'Gave up',
  cancelled: 'Cancelled by the agent',
};

const CASE_ICON: Record<TestCaseResult['status'], string> = {
  passed: '&#10003;',
  failed: '&#10007;',
  error: '!',
  skipped: '&ndash;',
};

function caseRow(c: TestCaseResult, index: number): string {
  const name = c.classname ? `${escapeHtml(c.classname)}::${escapeHtml(c.name)}` : escapeHtml(c.name);
  const detail = c.details ?? c.message;
  const head = `<span class="icon ${c.status}" aria-hidden="true">${CASE_ICON[c.status]}</span><span class="sr">${c.status}: </span><span class="name">${name}</span>`;
  if (!detail || c.status === 'passed' || c.status === 'skipped') return `<li class="case">${head}</li>`;
  return `<li class="case"><details data-key="case-${index}"><summary>${head}${c.message ? `<span class="msg">${escapeHtml(c.message.split('\n')[0] ?? '')}</span>` : ''}</summary><pre>${escapeHtml(detail)}</pre></details></li>`;
}

function testsSection(c: Challenge): string {
  const run = c.lastRun;
  const files = c.testFiles
    .map((f) => `<a href="#" data-file="${escapeHtml(f)}">${escapeHtml(basename(f))}</a>`)
    .join(', ');
  const parts: string[] = [`<h3>Tests</h3>`];
  parts.push(`<p class="muted">Command: <code>${escapeHtml(c.request.testCommand)}</code>${files ? ` &middot; Files: ${files}` : ''}</p>`);
  if (c.testsRunning) parts.push('<p class="running">Running tests&hellip;</p>');
  if (!run) {
    if (!c.testsRunning) parts.push('<p class="muted">No runs yet. Write your implementation, then press Run Tests.</p>');
  } else {
    const summary = run.timedOut
      ? 'Timed out'
      : run.total > 0
        ? `${run.passed}/${run.total} passing`
        : run.ok
          ? 'Command succeeded'
          : `Command failed (exit ${run.exitCode ?? 'n/a'})`;
    parts.push(`<p class="summary ${run.ok ? 'ok' : 'bad'}">${escapeHtml(summary)} <span class="muted">(run ${c.attempts}, ${Math.round(run.durationMs)} ms)</span></p>`);
    if (run.cases.length) parts.push(`<ul class="cases">${run.cases.map(caseRow).join('')}</ul>`);
    const output = [run.stdout, run.stderr].filter((s) => s.trim()).join('\n');
    if (output && !run.ok) parts.push(`<details data-key="output"><summary>Raw output</summary><pre>${escapeHtml(output)}</pre></details>`);
  }
  return parts.join('\n');
}

function finalSection(c: Challenge): string {
  const parts: string[] = [];
  if (c.status === 'passed') {
    parts.push(`<div class="banner ok"><strong>All tests pass.</strong> Your code goes back to the agent exactly as written.${c.notes ? ` <span class="muted">${escapeHtml(c.notes)}</span>` : ''}</div>`);
    if (c.reflection) parts.push(`<p><em>Your note:</em> ${escapeHtml(c.reflection)}</p>`);
  } else if (c.status === 'gave_up') {
    parts.push('<div class="banner warn"><strong>You gave up.</strong> The agent will implement it. Here is a reference if one was provided.</div>');
  } else if (c.status === 'cancelled') {
    parts.push(`<div class="banner warn"><strong>Cancelled.</strong>${c.reason ? ` ${escapeHtml(c.reason)}` : ''}</div>`);
  } else if (c.status === 'declined') {
    parts.push('<div class="banner warn"><strong>Skipped.</strong></div>');
  }
  if ((c.status === 'passed' || c.status === 'gave_up') && c.request.referenceSolution) {
    parts.push(`<details data-key="reference"><summary>Reference solution</summary><pre>${escapeHtml(c.request.referenceSolution)}</pre></details>`);
  }
  return parts.join('\n');
}

/** The inner content of the panel (re-rendered on every state change). */
export function renderPanelBody(c: Challenge): string {
  const inProgress = c.status === 'active';
  const req = c.request;
  const meta = [`difficulty ${req.difficulty}/5`, ...req.concepts].map((m) => `<span class="chip">${escapeHtml(m)}</span>`).join('');
  return `
<header>
  <h1>${escapeHtml(req.symbol)}</h1>
  <span class="status ${c.status}">${escapeHtml(STATUS_LABEL[c.status])}</span>
</header>
<div class="chips">${meta}</div>
<pre class="signature"><code>${escapeHtml(req.signature)}</code></pre>
<div class="actions">
  <button data-action="runTests"${inProgress && !c.testsRunning ? '' : ' disabled'}>${c.testsRunning ? 'Running&hellip;' : 'Run Tests'}</button>
  <button data-action="giveUp" class="secondary"${inProgress ? '' : ' disabled'}>Give Up</button>
  <button data-action="openFile" data-file="${escapeHtml(c.file?.absPath ?? req.file)}" class="secondary">Go to function</button>
</div>
${finalSection(c)}
<section class="spec"><h3>Spec</h3>${renderMarkdownLite(req.spec)}</section>
<section>${testsSection(c)}</section>`;
}

const STYLE = `
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px 20px 40px; line-height: 1.5; }
header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 1.5em; margin: 0; font-family: var(--vscode-editor-font-family); }
h2,h3,h4,h5 { margin: 1.2em 0 .4em; }
.chips { margin: 6px 0; display: flex; gap: 6px; flex-wrap: wrap; }
.chip { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; padding: 0 8px; font-size: .85em; }
.status { font-size: .9em; padding: 1px 8px; border-radius: 3px; border: 1px solid var(--vscode-panel-border); }
.status.passed { border-color: var(--vscode-testing-iconPassed); color: var(--vscode-testing-iconPassed); }
.status.gave_up, .status.cancelled, .status.declined { color: var(--vscode-descriptionForeground); }
pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px; border-radius: 4px; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre-wrap; }
code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
pre code { background: none; padding: 0; }
.actions { display: flex; gap: 8px; margin: 12px 0; flex-wrap: wrap; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid transparent; padding: 4px 14px; cursor: pointer; border-radius: 2px; font-family: inherit; font-size: inherit; }
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, a:focus-visible, summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
a { color: var(--vscode-textLink-foreground); }
.muted { color: var(--vscode-descriptionForeground); }
.banner { padding: 8px 12px; border-left: 3px solid; margin: 10px 0; background: var(--vscode-textBlockQuote-background); }
.banner.ok { border-color: var(--vscode-testing-iconPassed); }
.banner.warn { border-color: var(--vscode-editorWarning-foreground); }
.cases { list-style: none; padding: 0; margin: 6px 0; }
.case { padding: 2px 0; }
.case summary { cursor: pointer; }
.icon { display: inline-block; width: 1.4em; font-weight: bold; }
.icon.passed { color: var(--vscode-testing-iconPassed); }
.icon.failed, .icon.error { color: var(--vscode-testing-iconFailed); }
.icon.skipped { color: var(--vscode-testing-iconSkipped); }
.msg { margin-left: 10px; color: var(--vscode-descriptionForeground); }
.summary.ok { color: var(--vscode-testing-iconPassed); }
.summary.bad { color: var(--vscode-testing-iconFailed); }
.running { color: var(--vscode-descriptionForeground); font-style: italic; }
.sr { position: absolute; left: -9999px; }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const root = document.getElementById('root');
function openKeys() { return new Set([...root.querySelectorAll('details[open]')].map(d => d.dataset.key)); }
window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'render') return;
  const open = openKeys();
  root.innerHTML = e.data.html;
  root.querySelectorAll('details').forEach(d => { if (open.has(d.dataset.key)) d.open = true; });
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action],[data-file]');
  if (!el || el.disabled) return;
  e.preventDefault();
  const action = el.dataset.action || 'openFile';
  vscode.postMessage({ type: action, file: el.dataset.file });
});
`;

/** Full HTML document with a strict CSP. */
export function renderPanelHtml(c: Challenge, nonce: string, cspSource: string): string {
  const csp = `default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; font-src ${cspSource};`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Diby</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<div id="root">${renderPanelBody(c)}</div>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}
