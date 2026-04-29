/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#00163B',
          gold: '#D6BF8D',
          bg: '#f8f6f3',
          'gold-dark': '#c5ae7c',
          'navy-light': '#002855',
        },
      },
    },
  },
  plugins: [],
};
