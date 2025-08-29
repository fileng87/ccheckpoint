import { defineConfig } from 'eslint/config';
import tsconfig from 'typescript-eslint';

export default defineConfig([
  tsconfig.configs.recommended,
  {
    ignores: ['dist/**/*', 'node_modules/**/*'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
]);
