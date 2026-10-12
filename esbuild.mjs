// Builds two bundles:
//   src/extension.ts -> dist/extension.js  (VS Code extension host, cjs, `vscode` external)
//   src/shim/main.ts -> dist/mcp-shim.js   (standalone stdio MCP server, run with plain `node`)
// Usage: node esbuild.mjs [--watch] [--production]
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: production ? false : 'linked',
  minify: production,
  logLevel: 'info',
  define: { __DIBY_VERSION__: JSON.stringify(pkg.version) },
};

/** Prints esbuild results in a format the VS Code `$esbuild-watch`-style matcher in tasks.json understands. */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
      }
      console.log('[watch] build finished');
    });
  },
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
    target: 'node20',
    plugins: [problemMatcherPlugin],
  }),
  esbuild.context({
    ...common,
    entryPoints: ['src/shim/main.ts'],
    outfile: 'dist/mcp-shim.js',
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
    plugins: [problemMatcherPlugin],
  }),
]);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
