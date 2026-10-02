import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ESLint runs inside web/ only, so .claude/skills/ and skills-lock.json are out of its reach.
  { ignores: ['dist/', 'test-results/', 'node_modules/', '**/package-lock.json'] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      'no-console': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'anywhere' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // With noUncheckedIndexedAccess, `!` marks lookups known to exist.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['tests/**/*.{ts,mjs}', '*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Command-line helpers print their results.
    files: ['tests/support/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
