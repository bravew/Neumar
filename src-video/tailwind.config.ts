import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#8B3A00',
          'primary-dark': '#C25A1A',
          shadow: '#3d1a00',
        },
        surface: {
          bg: '#0a0a0a',
          card: '#1a1a1a',
          border: '#2a2a2a',
        },
      },
      fontFamily: {
        heading: ['Inter', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
