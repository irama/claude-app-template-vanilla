import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import noWaitForCallThenQuery from './eslint-rules/no-wait-for-call-then-query.mjs'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    },
  },
  {
    // The vendored rule from status.peakstate.global/packages/eslint-rules.
    // Bans `await waitFor(<a call>)` followed by a synchronous screen query —
    // a barrier that passes or fails on tick timing and flakes under load.
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**/*.{ts,tsx}'],
    plugins: { local: { rules: { 'no-wait-for-call-then-query': noWaitForCallThenQuery } } },
    rules: { 'local/no-wait-for-call-then-query': 'error' },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
])

export default eslintConfig
