// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignore generated and dependency directories
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // TypeScript recommended rules for source files
  ...tseslint.configs.recommended,

  // Project-specific overrides
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      // Allow explicit `any` only where truly needed; prefer `unknown`
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused variables are almost always bugs
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
