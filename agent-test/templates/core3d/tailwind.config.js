/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,html}'],
  theme: {
    extend: {
      fontFamily: { retro: ['ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
};
