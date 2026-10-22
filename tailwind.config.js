/** @type {import('tailwindcss').Config} */

/**
 * Theme colours are defined as raw RGB channels in `src/styles/tailwind.css`.
 * Referencing them through `rgb(... / <alpha-value>)` is what allows Tailwind
 * to emit opacity modifiers such as `bg-primary/10` or `to-secondary/80`.
 * Without it those utilities are silently dropped from the build.
 */
const themeColor = (name) => `rgb(var(--color-${name}-rgb) / <alpha-value>)`;

/**
 * `border` keeps its subtle default alpha (9% in light mode, 14% in dark mode)
 * rather than rendering a fully opaque line, while still supporting modifiers
 * such as `border-error/20`.
 */
const borderThemeColor = ({ opacityValue, opacityVariable }) =>
  opacityValue === undefined || opacityVariable
    ? 'rgb(var(--color-border-rgb) / var(--color-border-alpha))'
    : `rgb(var(--color-border-rgb) / ${opacityValue})`;

const fontSans = [
  'Inter',
  'system-ui',
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'sans-serif',
];

const fontMono = [
  'JetBrains Mono',
  'ui-monospace',
  'SF Mono',
  'Menlo',
  'Consolas',
  'monospace',
];

module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: borderThemeColor, // slate-900 @ 9%
        input: themeColor('input'),
        ring: themeColor('ring'), // teal-700 / teal-400
        background: themeColor('background'), // off-white / charcoal
        foreground: themeColor('foreground'), // slate-900 / slate-200
        surface: {
          DEFAULT: themeColor('surface'),
          foreground: themeColor('surface-foreground'),
        },
        primary: {
          DEFAULT: themeColor('primary'), // teal
          foreground: themeColor('primary-foreground'),
        },
        secondary: {
          DEFAULT: themeColor('secondary'), // slate
          foreground: themeColor('secondary-foreground'),
        },
        accent: {
          DEFAULT: themeColor('accent'), // sky — informational / AI surfaces
          foreground: themeColor('accent-foreground'),
        },
        destructive: {
          DEFAULT: themeColor('destructive'),
          foreground: themeColor('destructive-foreground'),
        },
        success: {
          DEFAULT: themeColor('success'), // emerald
          foreground: themeColor('success-foreground'),
        },
        warning: {
          DEFAULT: themeColor('warning'), // amber
          foreground: themeColor('warning-foreground'),
        },
        error: {
          DEFAULT: themeColor('error'), // red
          foreground: themeColor('error-foreground'),
        },
        muted: {
          DEFAULT: themeColor('muted'),
          foreground: themeColor('muted-foreground'),
        },
        card: {
          DEFAULT: themeColor('card'),
          foreground: themeColor('card-foreground'),
        },
        popover: {
          DEFAULT: themeColor('popover'),
          foreground: themeColor('popover-foreground'),
        },

        /**
         * Severity scale — the single source of truth for how a finding's
         * severity is rendered anywhere in the product.
         *
         *   critical = red     high = amber
         *   medium   = blue    low  = emerald   info = slate
         *
         * Colour is never the only signal: severity badges always render the
         * severity name and a distinct glyph.
         */
        critical: themeColor('critical'),
        high: themeColor('high'),
        medium: themeColor('medium'),
        low: themeColor('low'),
        info: themeColor('info'),
      },
      borderRadius: {
        xl: 'var(--radius-xl)',
        lg: 'var(--radius-lg)',
        md: 'var(--radius-md)',
        sm: 'var(--radius-sm)',
      },
      fontFamily: {
        sans: fontSans,
        mono: fontMono,
        // Semantic aliases — headings use the readable UI sans, data uses mono.
        heading: fontSans,
        body: fontSans,
        data: fontMono,
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      boxShadow: {
        'elevation-1': '0 1px 2px rgba(15, 23, 42, 0.06)',
        'elevation-2': '0 4px 12px rgba(15, 23, 42, 0.08)',
        'elevation-3': '0 12px 32px rgba(15, 23, 42, 0.12)',
        'glow-md': '0 4px 20px rgba(15, 118, 110, 0.18)',
        'glow-lg': '0 12px 32px rgba(15, 118, 110, 0.16)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideIn: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideOut: {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '100%': { transform: 'translateY(-10px)', opacity: '0' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        successBounce: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.06)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 150ms ease-out',
        'fade-out': 'fadeOut 150ms ease-out',
        'slide-in': 'slideIn 300ms ease-in-out',
        'slide-out': 'slideOut 300ms ease-in-out',
        'scale-in': 'scaleIn 150ms ease-out',
        'success-bounce': 'successBounce 600ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        '150': '150ms',
        '300': '300ms',
      },
      transitionTimingFunction: {
        'ease-out': 'cubic-bezier(0, 0, 0.2, 1)',
        'ease-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    require('tailwindcss-animate'),
  ],
};
