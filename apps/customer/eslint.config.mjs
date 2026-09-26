// Reuse the monorepo ESLint config so every workspace lints identically.
import parent from '../../eslint.config.mjs';
import globals from 'globals';

export default [
  // The persistent Chrome profile behind the QA harness is browser state,
  // not source — Chrome drops downloaded assets (e.g. WasmTtsEngine) in it.
  { ignores: ['.qa-profile/**'] },
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
