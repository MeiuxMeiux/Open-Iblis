// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Layer and cycle rules for the shell (just shell-deps). The renderer runs
// sandboxed and reaches main only through the preload bridge; shared/ holds
// contracts both sides import and so may import neither.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cycles',
      severity: 'error',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } }
    },
    {
      name: 'renderer-not-main',
      comment: 'The renderer never imports main-process or preload code.',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^electron/' }
    },
    {
      name: 'main-not-renderer',
      comment: 'Main and preload never import renderer code.',
      severity: 'error',
      from: { path: '^electron/' },
      to: { path: '^src/' }
    },
    {
      name: 'shared-is-leaf',
      comment: 'shared/ contracts import neither side.',
      severity: 'error',
      from: { path: '^shared/' },
      to: { path: '^(src|electron)/' }
    },
    {
      name: 'renderer-no-node',
      comment: 'The renderer has no Node built-ins (and so no network or fs).',
      severity: 'error',
      from: { path: '^src/' },
      to: { dependencyTypes: ['core'] }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.node.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.svelte', '.js', '.mjs', '.cjs', '.json'] }
  }
}
