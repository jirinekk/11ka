/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./views/**/*.ejs', './public/js/**/*.js'],
  safelist: [
    'right-3',
    'left-auto',
    'translate-x-0',
    'sm:right-auto',
    'sm:left-1/2',
    'sm:-translate-x-1/2',
    'hidden',
    'md:hidden',
    'md:block',
    'md:flex',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        article: ['11ka Article', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        '11bg': '#0b111b',
        '11card': '#151c2c',
        '11accent': '#16dffb',
        '11muted': '#94a3b8',
      },
    },
  },
};
