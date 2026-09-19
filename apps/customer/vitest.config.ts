import { defineConfig } from 'vitest/config';

/**
 * Vitest runs the app's framework-free logic: the auth store, the storage
 * abstraction, API error presentation and money formatting.
 *
 * React Native and the native `expo-secure-store` module do not load in a Node
 * process, so specs deliberately stay on the pure side of those boundaries —
 * that is what the injectable `SecureStorage` interface is for. Component
 * behaviour is not covered here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Loading React Native's Babel transform on every file would dominate the run.
    exclude: ['node_modules/**', 'dist/**', '.expo/**'],
  },
});
