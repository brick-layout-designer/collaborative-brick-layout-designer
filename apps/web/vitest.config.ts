import { defineConfig } from 'vitest/config';
import { workspaceSources } from '../../vitest.sources';
import react from '@vitejs/plugin-react';

export default defineConfig({
  resolve: { alias: workspaceSources() },
  plugins: [react()],
  // Layout-file fixtures load as data URLs (`?inline`).
  assetsInclude: ['**/*.bld-layout'],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    setupFiles: ['src/test/setup.ts'],
    // theme.test.ts reads styles.css?raw to check it against tokens.ts.
    css: { include: [/styles\.css/] },
  },
});
