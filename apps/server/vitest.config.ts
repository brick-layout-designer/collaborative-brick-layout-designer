import { defineConfig } from 'vitest/config';
import { workspaceSources } from '../../vitest.sources';

export default defineConfig({
  resolve: { alias: workspaceSources() },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    pool: 'forks',
    forks: { singleFork: true },
  },
});
