import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    // never sweep sibling threads' worktrees into this checkout's run — a worktree under
    // .claude/ holds a full second copy of the suite, so without this the run doubles and
    // the two copies collide on module-level singletons.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.claude/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],

    environment: 'happy-dom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
      },
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.config.*',
        '**/types/**',
        '.next/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
