/**
 * Clinical copy in both languages, written inline at the point of use.
 *
 * `t('ไทย', 'English')` rather than a dictionary of keys, for one reason: every
 * one of these sentences describes a threshold that sits a few lines away, and
 * a reviewer checking the English against the Thai has to see both next to the
 * number they describe. A key-based dictionary puts the two languages in a
 * different file from the rule and from each other, which is how a threshold
 * changes in one language and not the other.
 *
 * Field names on the wire keep their `Th` suffix — `titleTh`, `bodyTh` and the
 * rest now carry whichever language was asked for. Renaming 431 call sites
 * belongs in its own change, not mixed into copy that a pharmacist has to read.
 */

export type Locale = 'th' | 'en';

export type T = (th: string, en: string) => string;

export const tx =
  (locale: Locale): T =>
  (th, en) =>
    locale === 'en' ? en : th;

/** Thai has no plural inflection; English does. */
export const plural = (locale: Locale, n: number, one: string, many: string): string =>
  locale === 'en' && n !== 1 ? many : one;

export const isLocale = (v: unknown): v is Locale => v === 'th' || v === 'en';
export const asLocale = (v: unknown): Locale => (v === 'en' ? 'en' : 'th');
