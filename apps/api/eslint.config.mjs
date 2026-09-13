import base from '../../eslint.config.mjs';

export default [
  {
    // Prisma generates plain TypeScript into src/generated. It is build output:
    // never hand-edited, never linted.
    ignores: ['src/generated/**', 'dist/**', 'coverage/**'],
  },
  ...base,
];
