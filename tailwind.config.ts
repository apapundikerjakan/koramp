import type { Config } from 'tailwindcss';

/**
 * Kiswap tokens — "digital money-changer counter" (bottle green + brass + ivory).
 *
 * NOTE on `brand-*` classes: the ramp below is brass, not indigo. The class
 * prefix is kept as a stable alias so ~60 existing usages keep working while
 * the hue system is totally replaced (indigo #4f46e5 → brass #C7A048).
 * New code should prefer `accent` / `pine` / `ink` names.
 */
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
          50: '#FBF7ED',
          100: '#F4EAD0',
          200: '#E8D5A4',
          300: '#D9B75F',
          400: '#CFA94E',
          500: '#C7A048',
          600: '#A8863A',
          700: '#866A2E',
          800: '#6D5729',
          900: '#5B4824',
          950: '#332913',
        },
        accent: {
          DEFAULT: '#C7A048',
          hover: '#D9B75F',
          deep: '#1F5C43',
        },
        pine: {
          DEFAULT: '#1F5C43',
          bright: '#2A7A58',
          dim: '#153E2D',
        },
        // ── Kiswap closed color system ──
        base: '#0E120F',
        surface: {
          1: '#131916',
          2: '#182019',
          3: '#1F2A21',
        },
        line: {
          subtle: '#243026',
          DEFAULT: '#2C3A2E',
          strong: '#3D5240',
        },
        ink: {
          primary: '#F5F1E8',
          secondary: '#9FAB9F',
          muted: '#5E6B60',
          disabled: '#374151',
        },
      },
      fontFamily: {
        sans: ['"Public Sans"', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'brand-glow': '0 0 20px rgba(199, 160, 72, 0.18)',
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
