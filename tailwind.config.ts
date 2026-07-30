import type { Config } from 'tailwindcss';

/**
 * Two colour roles per zone. The brand palette was checked against WCAG on the
 * cream background and three of its colours fail as text — gold sits at 2.29:1,
 * the "high" amber at 2.68:1, the "in target" green at 3.66:1. So each zone has
 * a fill for bars and bands, and a darker `-ink` variant for any glyph or digit.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: '#F7F4EE', raised: '#FFFFFF', sunken: '#EFEAE0' },
        ink: { DEFAULT: '#2A2E22', 70: '#68695F', 40: '#86877E' },
        line: { DEFAULT: 'rgba(42,46,34,.12)', soft: 'rgba(42,46,34,.07)' },
        olive: { DEFAULT: '#3D5826', light: '#5C7A3F', dark: '#2E4420' },
        gold: { DEFAULT: '#C99D2F', ink: '#876920' },
        zone: {
          in: '#3E8E5A', 'in-ink': '#367C4F',
          high: '#C98A1E', 'high-ink': '#946516',
          vhigh: '#B4472F', 'vhigh-ink': '#B4472F',
          low: '#3A6E86', 'low-ink': '#3A6E86',
        },
      },
      fontFamily: {
        head: ['var(--font-kanit)', 'sans-serif'],
        body: ['var(--font-sarabun)', 'sans-serif'],
      },
      borderRadius: { xs: '8px', sm: '12px', md: '16px', lg: '22px', xl: '28px' },
      boxShadow: {
        sm: '0 4px 14px rgba(42,46,34,.07)',
        md: '0 8px 26px rgba(42,46,34,.08)',
        lg: '0 18px 48px rgba(42,46,34,.12)',
      },
    },
  },
  plugins: [],
};
export default config;
