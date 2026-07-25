import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import aftergame from '@aftergame/eslint-rules';

/**
 * Flat config for the whole workspace.
 *
 * Three layers:
 *   1. Standard JS + TypeScript recommendations.
 *   2. Type-aware rules on source files (the ones that catch real bugs, e.g. floating promises).
 *   3. Aftergame's own invariants — see packages/eslint-rules. Two of those three are security
 *      controls, so they are errors, never warnings.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/*.tsbuildinfo',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Type-aware linting, scoped to real source so config files don't need a tsconfig entry.
  {
    files: ['apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx', 'packages/*/src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unawaited promise in a request handler is a silent 200 with no side effects.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // `require-await` is off deliberately: Fastify's plugin and handler contracts are async
      // whether or not the body happens to await, so the rule flags correct framework code.
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Baseline rules everywhere.
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { aftergame },
    rules: {
      'aftergame/no-prisma-outside-repositories': 'error',
      'aftergame/no-imports-in-game-core': 'error',
      'aftergame/no-identity-fields-in-dto': 'error',

      // `_`-prefixed args are the documented way to say "deliberately unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',

      // Stored XSS has no surface if this never appears (docs/07-security.md).
      'no-restricted-properties': [
        'error',
        {
          object: 'document',
          property: 'write',
          message: 'Never inject markup directly.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            'User content is never rendered as HTML in this app. See docs/07-security.md (XSS).',
        },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // Browser code.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Plain-JS lint rules package: no TypeScript rules apply.
  {
    files: ['packages/eslint-rules/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },

  // Tests may reach for the sharp tools.
  {
    files: ['**/*.{test,spec}.{ts,tsx,js}', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Must stay last: turns off everything Prettier already handles.
  prettier,
);
