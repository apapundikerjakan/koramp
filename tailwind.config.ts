import type { Config } from 'tailwindcss';

/**
 * KIPRAMP tokens — "digital money-changer counter" (bottle green + brass + ivory).
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
          50: '#FAF6EE',
          100: '#F3EAD7',
          200: '#E8D5AE',
          300: '#E2C9A5',
          400: '#D4B78F',
          500: '#D4B78F',
          600: '#B89A6B',
          700: '#96794F',
          800: '#77603F',
          900: '#5F4D34',
          950: '#332913',
        },
        accent: {
          DEFAULT: '#D4B78F',
          hover: '#E2C9A5',
          deep: '#1A2E1C',
        },
        gold: {
          DEFAULT: '#D4B78F',
          hover: '#E2C9A5',
        },
        pine: {
          DEFAULT: '#1A2E1C',
          bright: '#22C55E',
          dim: '#0F1F11',
        },
        // ── KIPRAMP luxury system ──
        base: '#08080A',
        surface: {
          1: '#141416',
          2: '#1A1A1E',
          3: '#232326',
        },
        line: {
          subtle: '#232326',
          DEFAULT: '#2A2A2E',
          strong: '#333338',
        },
        ink: {
          primary: '#F5F5F5',
          secondary: '#8B8B93',
          muted: '#5A5A60',
          disabled: '#3A3A3E',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Geist', 'system-ui', 'sans-serif'],
        display: ['Inter', 'Geist', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SF Mono', 'monospace'],
      },
      boxShadow: {
        'brand-glow': '0 0 20px rgba(212,183,143,0.15)',
        'gold-glow': '0 0 20px rgba(212,183,143,0.15)',
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
        'scroll-dot': 'scrollDot 1.8s ease-in-out infinite',
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
