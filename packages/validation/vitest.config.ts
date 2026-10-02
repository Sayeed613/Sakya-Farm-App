import { defineConfig } from 'vitest/config';

/**
 * Specs run from `src/` only. Build output (`dist/`) is deliberately never
 * collected: an old compiled `dist/*.spec.js` (or any other emitted artefact)
 * would otherwise be picked up by Vitest's default globs and fail at import
 * time in CommonJS, reporting a red suite for code that is not under test.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
