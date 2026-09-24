// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

// Type-aware strict + stylistic rules. Findings that predate the switch live in
// eslint-suppressions.json and may only shrink (`just shell-lint-prune`); every
// rule option below that departs from the preset says why.
export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'dist/**', 'node_modules/**', '.vite/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        // tsconfig.json covers the renderer, tsconfig.node.json main + tests,
        // tsconfig.e2e.json the Playwright suite (Node plus in-page DOM code).
        project: ['./tsconfig.json', './tsconfig.node.json', './tsconfig.e2e.json'],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte']
      }
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser }
    }
  },
  {
    rules: {
      // State updates here copy-and-reassign ($state = new Set(prev).add(x)) and
      // the plain Map/Set caches are deliberately non-reactive, so SvelteMap/SvelteSet
      // would add tracking without changing behavior.
      'svelte/prefer-svelte-reactivity': 'off',
      // Numbers format predictably in templates (sizes, counts, HTTP codes).
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `() => doThing()` callbacks are the house style for event handlers.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // `void x` marks a deliberate read: Svelte dependency tracking inside
      // $effect/$derived, or a destructured value discarded on purpose.
      '@typescript-eslint/no-meaningless-void-operator': 'off',
      // Parsed JSON is typed optimistically; `=== true` on it is validation.
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off'
    }
  },
  {
    // Test doubles implement async interfaces with synchronous bodies, stub
    // callbacks as no-ops, and index fixtures the test itself just built.
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  },
  {
    // Plain JS configs and build scripts sit outside both TS projects.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked
  }
)
