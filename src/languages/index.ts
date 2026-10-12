/**
 * MODULE languages — adapter registry. Pure (no vscode).
 *
 * Adding a language (C++, C, Java, TS/JS, ...): write `createXAdapter(deps?)` returning a
 * `LanguageAdapter`, then add it to `adapters` below. Nothing else changes:
 * - build/compile steps go in `instrumentTestCommand` (prefix `cmd` with the build, e.g. `cmake --build . && ctest`),
 * - sandbox files (e.g. a bundled doctest header) go in the `tmpDir` it receives,
 * - JUnit-producing runners (Surefire, vitest/jest junit) reuse `parseJUnitXml` from `testing/junit.ts`,
 * - compiler errors become `TestRunResult.diagnostics` in `parseResults`.
 */
import type { LanguageAdapter, LanguageRegistry } from '../types';
import { createGenericAdapter } from './generic';
import { createPythonAdapter, type PythonAdapterDeps } from './python';
import { createTypeScriptAdapter } from './typescript';

export interface LanguageRegistryDeps {
  python?: PythonAdapterDeps;
}

/** Create a registry; unknown languages resolve to the generic exit-code adapter. */
export function createLanguageRegistry(deps: LanguageRegistryDeps = {}): LanguageRegistry {
  const generic = createGenericAdapter();
  const specific: LanguageAdapter[] = [createPythonAdapter(deps.python), createTypeScriptAdapter()];
  const byName = new Map<string, LanguageAdapter>();
  for (const a of specific) {
    byName.set(a.id.toLowerCase(), a);
    for (const alias of a.aliases) byName.set(alias.toLowerCase(), a);
  }
  const lookup = (language: string) => byName.get(language.trim().toLowerCase());
  return {
    get: (language) => lookup(language) ?? generic,
    has: (language) => lookup(language) !== undefined,
    list: () => [...specific, generic],
  };
}
