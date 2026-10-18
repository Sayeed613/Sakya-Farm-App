// Reuse the monorepo ESLint config so every workspace lints identically.
import parent from '../../eslint.config.mjs';
import globals from 'globals';

export default [
  // The persistent Chrome profiles behind the QA harnesses are browser state,
  // not source — Chrome drops downloaded assets (e.g. WasmTtsEngine) in them.
  // `.qa-profile` backs scripts/qa.mjs; `.qa-report` backs scripts/qa-full-pass.mjs
  // and the ui-diag probe, and holds the same generated Chrome profile trees.
  { ignores: ['.qa-profile/**', '.qa-report/**'] },
  ...parent,
  {
    // The QA journey harness (scripts/qa.mjs) runs in Node but drives a real
    // browser page: its evaluate() callbacks use DOM globals.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
];
