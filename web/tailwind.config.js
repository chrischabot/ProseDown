import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,js,html}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro"',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          'ui-monospace',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': theme('colors.slate.800'),
            '--tw-prose-headings': theme('colors.slate.900'),
            '--tw-prose-links': theme('colors.blue.600'),
            '--tw-prose-code': theme('colors.slate.900'),
            '--tw-prose-pre-bg': theme('colors.slate.50'),
            '--tw-prose-pre-code': theme('colors.slate.800'),
            maxWidth: '72ch',
            fontFeatureSettings: '"kern", "liga", "calt", "ss01"',
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            'blockquote p:first-of-type::before': { content: 'none' },
            'blockquote p:last-of-type::after': { content: 'none' },
          },
        },
        invert: {
          css: {
            '--tw-prose-pre-bg': 'rgba(255,255,255,0.04)',
          },
        },
      }),
    },
  },
  plugins: [typography],
};