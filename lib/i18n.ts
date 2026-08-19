import type { Locale } from './prefs';

/**
 * The client half of the same idea as server/cgm/i18n.ts: `t('ไทย', 'English')`
 * written where the string is used, rather than a dictionary of keys in another
 * file. One mechanism across the codebase, and a reviewer comparing the two
 * languages never has to hold a key in their head.
 */
export type T = (th: string, en: string) => string;

export const tx =
  (locale: Locale): T =>
  (th, en) =>
    locale === 'en' ? en : th;
