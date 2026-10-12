# Changelog

All notable changes to Diby are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Shorter README; the roadmap to v0.1.0 (with a Gantt chart) now lives in `ROADMAP.md`.

## [0.0.4] - 2026-10-12

### Added

- `diby.quietHours` setting: a daily local-time window (e.g. `22:00-07:30`) in which agents' offers are declined.
- `diby.disableInlineSuggestions` (on by default): inline suggestions such as Copilot ghost text are turned off while a challenge is active and restored afterwards, including after a crash.

## [0.0.3] - 2026-10-12

### Added

- **Show Stats** lists the concepts that need practice: the lowest pass rates among concepts you attempted at least twice.
- TypeScript / JavaScript adapter: vitest challenges show per-test results, failure diffs and editor diagnostics in the panel instead of exit-code-only output.

### Fixed

- The challenge panel fell back to a serif font when `editor.fontFamily` named a font without a generic fallback.

## [0.0.2] - 2026-10-12

### Added

- `diby.offerStyle` setting: show offers as a modal dialog (the new default), an editor tab with the full spec and Accept / Skip / Snooze buttons, or a notification as before.
- A pending offer stays on the status bar until you answer; click it (or run **Diby: Show Pending Offer**) to open it.
- **Diby: Show Stats** command and a streak badge on the status bar: pass rate, current daily streak and per-concept totals from your challenge history.

### Fixed

- Offers no longer disappear unseen. The old notification auto-hid after a few seconds and, when nobody answered, the challenge was silently recorded as skipped. Unanswered offers are now marked "not answered in time", and accepting an expired modal or notification tells you it expired instead of doing nothing.

## [0.0.1] - 2026-10-12

### Added

- Initial project scaffold: extension manifest, build and test tooling, MCP shim and HTTP bridge layout, Python and generic language adapters, and open-source repository boilerplate (CI, issue and PR templates, contributing guide, code of conduct).
- Release workflow that builds the `.vsix` and attaches it to a GitHub release.

### Changed

- New human-made logo (code brackets around a pencil). The README wordmark (light and dark variants), Marketplace icon and gallery banner now use it.
