import type { Config } from 'tailwindcss';

/**
 * Colours resolve through CSS variables so one palette definition serves both
 * themes: globals.css swaps the variables, every utility class follows.
 *
 * Two colour roles per zone, kept from the light-only design. The brand palette
 * was checked against WCAG on the cream background and three of its colours
 * fail as text — gold sits at 2.29:1, the "high" amber at 2.68:1, the "in
 * target" green at 3.66:1. So each zone has a fill for bars and bands, and a
 * darker `-ink` variant for any glyph or digit. The dark palette repeats the
 * exercise against the dark ground, where the fills are the ones too dark to
 * read and the `-ink` variants are lifted instead.
 */
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: c('--c-surface'), raised: c('--c-surface-raised'), sunken: c('--c-surface-sunken') },
        ink: { DEFAULT: c('--c-ink'), 70: c('--c-ink-70'), 40: c('--c-ink-40') },
        line: { DEFAULT: 'var(--c-line)', soft: 'var(--c-line-soft)' },
        olive: { DEFAULT: c('--c-olive'), light: c('--c-olive-light'), dark: c('--c-olive-dark') },
        gold: { DEFAULT: c('--c-gold'), ink: c('--c-gold-ink') },
        // Buttons carry white text in both themes, so the accent has to stay
        // dark in both — unlike `olive`, which lightens so it can be read as
        // text on the dark ground.
        accent: { DEFAULT: c('--c-accent'), ink: c('--c-on-accent') },
        tooltip: c('--c-tooltip'),
        zone: {
          in: c('--c-zone-in'), 'in-ink': c('--c-zone-in-ink'),
          high: c('--c-zone-high'), 'high-ink': c('--c-zone-high-ink'),
          vhigh: c('--c-zone-vhigh'), 'vhigh-ink': c('--c-zone-vhigh-ink'),
          low: c('--c-zone-low'), 'low-ink': c('--c-zone-low-ink'),
        },
      },
      fontFamily: {
        head: ['var(--font-kanit)', 'sans-serif'],
        body: ['var(--font-sarabun)', 'sans-serif'],
      },
      borderRadius: { xs: '8px', sm: '12px', md: '16px', lg: '22px', xl: '28px' },
      boxShadow: {
        sm: '0 4px 14px var(--c-shadow)',
        md: '0 8px 26px var(--c-shadow)',
        lg: '0 18px 48px var(--c-shadow-lg)',
      },
    },
  },
  plugins: [],
};
export default config;
