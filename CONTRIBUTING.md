# Contributing to Diby

Thanks for your interest in Diby. Bug reports, feature ideas, and pull requests are all welcome.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Setup

Diby targets Node 22+ (see `.nvmrc` for the version we develop on) and VS Code 1.101+.

```bash
npm install
npm run build      # esbuild: dist/extension.js and dist/mcp-shim.js
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

To try the extension, open this folder in VS Code and press **F5** ("Run Diby Extension"). That launches an Extension Development Host on `examples/python-sample`.

Python fixture tests shell out to [uv](https://docs.astral.sh/uv/). Install it, or those tests will be skipped locally. CI always runs them.

## Adding a language adapter

Adapters implement `LanguageAdapter` from `src/types.ts`. The TSDoc there is normative.

1. Add `src/languages/<name>.ts` exporting a `create<Name>Adapter()` factory.
2. Implement `validateStub`, `instrumentTestCommand`, `parseResults` and the optional hooks it needs (for example `resolveInterpreter` or `locateSymbol`). Keep the adapter free of VS Code imports where possible, so it stays unit-testable.
3. Register it in `src/languages/index.ts`.
4. Add unit tests at `test/languages/<name>.test.ts`, mirroring the source path. Use real test-runner output as fixtures, and gate any integration test with `it.skipIf` when its tool is missing.
5. Update the language table in the README.

See `ARCHITECTURE.md` section 4.3 for the existing Python and generic behaviour. For a new language, open a [language support request](../../issues/new?template=language_support.yml) first if you want feedback on the approach.

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(python): parse pytest xunit output for subtests
fix(bridge): reject requests with a stale bearer token
docs: clarify uv install step
```

Use a short imperative subject (about 72 characters or fewer). Add a body when the why is not obvious.

## Pull requests

- Keep PRs focused. One behaviour change per PR.
- Make sure `npm run typecheck`, `npm test` and `npm run build` pass locally.
- Add or update tests for behaviour changes.
- Fill in the PR template.
- Add a line under `[Unreleased]` in `CHANGELOG.md` for user-visible changes.

## Reporting issues

Use the issue templates. For security problems, please do not open a public issue. Contact the maintainers privately through GitHub instead.
