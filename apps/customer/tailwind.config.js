/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      /**
       * Sakya Farms palette. Values mirror src/theme/tokens.ts so the
       * Tailwind classes and the existing design tokens stay in sync.
       */
      colors: {
        canvas: '#FBF7F0',
        surface: '#FFFFFF',
        'surface-muted': '#F3EDE3',
        ink: '#171A18',
        'ink-soft': '#777B77',
        hero: '#26332B',
        brand: {
          DEFAULT: '#0B594C',
          dark: '#08483E',
        },
        cream: '#F8F5ED',
        line: '#DEDBD0',
        danger: '#B42318',
      },
      fontFamily: {
        /** Brand serif for the wordmark, tagline and headings. */
        serif: ['Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
