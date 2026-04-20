/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        outlook: {
          blue: '#0078D4',
          'blue-hover': '#106EBE',
          'blue-dark': '#005A9E',
          'bg-primary': '#F3F2F1',
          'bg-secondary': '#FFFFFF',
          'bg-hover': '#EDEBE9',
          'bg-selected': '#E1DFDD',
          'text-primary': '#323130',
          'text-secondary': '#605E5C',
          'text-disabled': '#A19F9D',
          'border': '#E1DFDD',
          'border-dark': '#8A8886',
          'danger': '#D13438',
          'success': '#107C10',
          'warning': '#FFB900',
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', '-apple-system', 'BlinkMacSystemFont', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        '2xs': '0.625rem',
      },
      animation: {
        'slide-in': 'slideIn 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
