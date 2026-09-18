import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f4ff',
          100: '#e0eaff',
          200: '#c7d7fe',
          300: '#a5bafc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        // ── Kiswap closed color system (prompt UI §3) ──
        base: '#07071a',
        surface: {
          1: '#0b0b1f',
          2: '#111128',
          3: '#16163a',
        },
        line: {
          subtle: '#1a1a3e',
          DEFAULT: '#1e1e45',
          strong: '#2d2d6b',
        },
        ink: {
          primary: '#ffffff',
          secondary: '#9ca3af',
          muted: '#4b5563',
          disabled: '#374151',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Geist', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'brand-glow': '0 0 20px rgba(99, 102, 241, 0.15)',
        'sol-glow': '0 8px 32px rgba(168, 85, 247, 0.20)',
        'eth-glow': '0 8px 32px rgba(59, 130, 246, 0.20)',
        'bnb-glow': '0 8px 32px rgba(234, 179, 8, 0.20)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        'beam-spin': 'beamSpin 4s linear infinite',
        shimmer: 'shimmer 1.8s linear infinite',
        'pulse-ring': 'pulseRing 2s cubic-bezier(0.0, 0, 0.2, 1) infinite',
        orb: 'orbBounce 1.2s ease-in-out infinite',
        'float-y': 'floatY 5s ease-in-out infinite',
        shake: 'shake 0.4s ease-in-out',
        'spin-slow': 'spin 2.5s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        beamSpin: {
          to: { transform: 'rotate(360deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseRing: {
          '0%': { transform: 'scale(0.85)', opacity: '0.7' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        orbBounce: {
          '0%, 100%': { transform: 'translateY(0)', opacity: '0.5' },
          '50%': { transform: 'translateY(-6px)', opacity: '1' },
        },
        floatY: {
          '0%, 100%': { transform: 'translateY(-6px)' },
          '50%': { transform: 'translateY(6px)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-6px)' },
          '40%, 80%': { transform: 'translateX(6px)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
