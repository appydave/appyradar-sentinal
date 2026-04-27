import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import globals from 'globals';

/**
 * Base ESLint flat config for AppySentinel projects.
 *
 * Sentinels are headless Bun/Node processes — no React/JSX rules,
 * no browser globals required by default.
 */
export default [
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/coverage/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: typescriptParser,
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
];
