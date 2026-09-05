import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * Unit tests only — pure modules under `src/**`. Component tests would need a
 * DOM environment and are out of scope for this config.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': `${here}src`,
      '@ai-coach/shared': `${here}../../packages/shared/src/index.ts`,
    },
  },
});
