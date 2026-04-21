/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        outlook: {
          blue: 'rgb(var(--outlook-blue) / <alpha-value>)',
          'blue-hover': 'rgb(var(--outlook-blue-hover) / <alpha-value>)',
          'blue-dark': 'rgb(var(--outlook-blue-dark) / <alpha-value>)',
          'bg-primary': 'rgb(var(--outlook-bg-primary) / <alpha-value>)',
          'bg-secondary': 'rgb(var(--outlook-bg-secondary) / <alpha-value>)',
          'bg-tertiary': 'rgb(var(--outlook-bg-tertiary) / <alpha-value>)',
          'bg-hover': 'rgb(var(--outlook-bg-hover) / <alpha-value>)',
          'bg-selected': 'rgb(var(--outlook-bg-selected) / <alpha-value>)',
          'text-primary': 'rgb(var(--outlook-text-primary) / <alpha-value>)',
          'text-secondary': 'rgb(var(--outlook-text-secondary) / <alpha-value>)',
          'text-disabled': 'rgb(var(--outlook-text-disabled) / <alpha-value>)',
          'text': 'rgb(var(--outlook-text-primary) / <alpha-value>)',
          'border': 'rgb(var(--outlook-border) / <alpha-value>)',
          'border-dark': 'rgb(var(--outlook-border-dark) / <alpha-value>)',
          'danger': 'rgb(var(--outlook-danger) / <alpha-value>)',
          'success': 'rgb(var(--outlook-success) / <alpha-value>)',
          'warning': 'rgb(var(--outlook-warning) / <alpha-value>)',
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
