/**
 * Reader preferences: language, theme, text size.
 *
 * All three are read back out of localStorage by an inline script that runs
 * before the first paint (see BOOT_SCRIPT). Doing it in React instead would
 * render the light theme, then repaint dark a frame later — a white flash in a
 * dim clinic room is exactly the thing a dark mode is meant to avoid.
 */

export type Theme = 'system' | 'light' | 'dark';
export type Locale = 'th' | 'en';

export type Prefs = {
  theme: Theme;
  locale: Locale;
  /** Multiplier on the root font size; every rem in the app follows it. */
  fontScale: number;
};

export const STORAGE_KEY = 'upcgm_prefs';

/** Thai first: this is a Thai coaching tool that also speaks English. */
export const DEFAULTS: Prefs = { theme: 'system', locale: 'th', fontScale: 1 };

/**
 * Four steps, not a slider. A slider invites 1.07× — a size nobody chose and
 * that no layout was checked at. The top step is 1.3 because past that the
 * two-column metric grid stops fitting a phone.
 */
export const FONT_STEPS = [0.9, 1, 1.15, 1.3] as const;

export function clampScale(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULTS.fontScale;
  // Snap to the nearest defined step so a hand-edited localStorage value cannot
  // put the app in a size that was never laid out.
  return FONT_STEPS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), DEFAULTS.fontScale);
}

export function normalise(raw: unknown): Prefs {
  const o = (raw ?? {}) as Partial<Prefs>;
  return {
    theme: o.theme === 'light' || o.theme === 'dark' ? o.theme : 'system',
    locale: o.locale === 'en' ? 'en' : 'th',
    fontScale: clampScale(o.fontScale),
  };
}

export function loadPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    return normalise(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return DEFAULTS;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* private mode: the app still works, the choice just will not survive a reload */
  }
}

/**
 * Push the preferences onto <html>. The CSS does the rest: `data-theme` beats
 * the system query in both directions, `lang` switches the line-height rule and
 * tells a screen reader which voice to use, and `--fs` scales the root size.
 */
export function applyPrefs(p: Prefs): void {
  const el = document.documentElement;
  if (p.theme === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', p.theme);
  el.setAttribute('lang', p.locale);
  el.style.setProperty('--fs', String(p.fontScale));
}

/**
 * Runs before first paint, inlined in <head>. Kept deliberately tiny and
 * dependency-free; it must never throw, because a throw here leaves the page
 * unstyled rather than merely un-themed.
 */
export const BOOT_SCRIPT = `(function(){try{
var p=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'{}');
var e=document.documentElement;
if(p.theme==='light'||p.theme==='dark')e.setAttribute('data-theme',p.theme);
if(p.locale==='en')e.setAttribute('lang','en');
var s=Number(p.fontScale);if(s>=0.9&&s<=1.3)e.style.setProperty('--fs',String(s));
}catch(_){}})();`;
