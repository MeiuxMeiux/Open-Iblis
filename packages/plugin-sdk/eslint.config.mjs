// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

// Same type-aware strict + stylistic baseline as the shell. Pre-existing
// findings live in eslint-suppressions.json and may only shrink.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'api-docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        // tsconfig.json builds src/ only; tests and config get the default project.
        projectService: { allowDefaultProject: ['tests/*.ts', 'vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    rules: {
      // Numbers format predictably in templates (sizes, counts, versions).
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // `void x` marks a value discarded on purpose.
      '@typescript-eslint/no-meaningless-void-operator': 'off',
      // Validators receive untyped JSON; `=== true` on it is validation.
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off'
    }
  },
  {
    // Tests index fixtures they just built.
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' }
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked
  }
)
