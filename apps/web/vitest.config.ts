import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Layout-file fixtures load as data URLs (`?inline`).
  assetsInclude: ['**/*.bld-layout'],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    setupFiles: ['src/test/setup.ts'],
  },
});
