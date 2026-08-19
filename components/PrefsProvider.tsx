'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { translate, type MsgKey } from '@/lib/i18n';
import {
  applyPrefs, DEFAULTS, FONT_STEPS, loadPrefs, savePrefs,
  type Locale, type Prefs, type Theme,
} from '@/lib/prefs';

type Ctx = {
  prefs: Prefs;
  t: (key: MsgKey, vars?: Record<string, string | number>) => string;
  setLocale: (l: Locale) => void;
  setTheme: (t: Theme) => void;
  setFontScale: (n: number) => void;
  /** False until the stored preferences have been read on the client. */
  ready: boolean;
};

const PrefsCtx = createContext<Ctx | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  // Starts at the defaults so the server and the first client render agree.
  // The inline boot script has already painted the right theme and text size by
  // now; this effect only catches React up on what the DOM already shows.
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = loadPrefs();
    setPrefs(stored);
    applyPrefs(stored);
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      applyPrefs(next);
      savePrefs(next);
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(() => ({
    prefs,
    ready,
    t: (key, vars) => translate(prefs.locale, key, vars),
    setLocale: (locale) => update({ locale }),
    setTheme: (theme) => update({ theme }),
    setFontScale: (fontScale) => update({ fontScale }),
  }), [prefs, ready, update]);

  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}

export function usePrefs(): Ctx {
  const ctx = useContext(PrefsCtx);
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return ctx;
}

/** Shorthand for components that only need the translator. */
export function useT() {
  return usePrefs().t;
}

export { FONT_STEPS };
