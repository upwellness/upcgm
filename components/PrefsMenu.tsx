'use client';

import { useEffect, useRef, useState } from 'react';
import { FONT_STEPS, usePrefs } from './PrefsProvider';
import type { Locale, Theme } from '@/lib/prefs';

/** One row of mutually exclusive choices, rendered as a real radio group. */
function Segmented<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: readonly { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label}>
      <div className="mb-1.5 text-[0.8rem] font-medium text-ink-70">{label}</div>
      <div className="flex gap-1 rounded-sm bg-surface-sunken p-1">
        {options.map((o) => {
          const on = o.v === value;
          return (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.v)}
              className={`flex-1 rounded-xs px-2 py-1.5 text-[0.85rem] transition-colors ${
                on ? 'bg-surface-raised font-semibold text-olive shadow-sm' : 'text-ink-70 hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function PrefsMenu() {
  const { prefs, t, setLocale, setTheme, setFontScale } = usePrefs();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — a popover that can only be closed by
  // hitting the same small button again is a trap on a phone.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const step = FONT_STEPS.indexOf(prefs.fontScale as (typeof FONT_STEPS)[number]);
  const atMin = step <= 0;
  const atMax = step >= FONT_STEPS.length - 1;

  return (
    <div ref={wrap} className="relative no-print">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('prefs.open')}
        title={t('prefs.open')}
        className="grid h-10 w-10 place-items-center rounded-sm border border-line bg-surface-raised text-ink-70 shadow-sm transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" stroke="currentColor"
             strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 16.11 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('prefs.title')}
          className="absolute right-0 z-40 mt-2 w-[17.5rem] rounded-md border border-line bg-surface-raised p-4 shadow-lg"
        >
          <div className="mb-3 font-head text-[0.95rem] font-semibold">{t('prefs.title')}</div>

          <div className="space-y-3.5">
            <Segmented<Locale>
              label={t('prefs.language')}
              value={prefs.locale}
              onChange={setLocale}
              options={[{ v: 'th', label: 'ไทย' }, { v: 'en', label: 'English' }]}
            />

            <Segmented<Theme>
              label={t('prefs.theme')}
              value={prefs.theme}
              onChange={setTheme}
              options={[
                { v: 'system', label: t('prefs.theme.system') },
                { v: 'light', label: t('prefs.theme.light') },
                { v: 'dark', label: t('prefs.theme.dark') },
              ]}
            />

            <div>
              <div className="mb-1.5 text-[0.8rem] font-medium text-ink-70">{t('prefs.textSize')}</div>
              <div className="flex items-center gap-1 rounded-sm bg-surface-sunken p-1">
                <button
                  type="button" disabled={atMin}
                  onClick={() => setFontScale(FONT_STEPS[Math.max(0, step - 1)])}
                  aria-label={t('prefs.textSize.smaller')} title={t('prefs.textSize.smaller')}
                  className="grid h-8 w-9 place-items-center rounded-xs bg-surface-raised text-[0.8rem] font-semibold shadow-sm disabled:opacity-35"
                >A</button>
                <div className="flex flex-1 justify-center gap-1" aria-hidden="true">
                  {FONT_STEPS.map((s, i) => (
                    <span key={s} className={`h-1.5 w-1.5 rounded-full ${i <= step ? 'bg-accent' : 'bg-line'}`} />
                  ))}
                </div>
                <button
                  type="button" disabled={atMax}
                  onClick={() => setFontScale(FONT_STEPS[Math.min(FONT_STEPS.length - 1, step + 1)])}
                  aria-label={t('prefs.textSize.larger')} title={t('prefs.textSize.larger')}
                  className="grid h-8 w-9 place-items-center rounded-xs bg-surface-raised text-[1.05rem] font-semibold shadow-sm disabled:opacity-35"
                >A</button>
              </div>
              <button
                type="button" onClick={() => setFontScale(1)}
                className="mt-1.5 text-[0.78rem] text-ink-40 underline underline-offset-2 hover:text-ink-70"
              >{t('prefs.textSize.reset')}</button>
            </div>

            {/* Shows the chosen size at the size a real reading is printed in. */}
            <div className="rounded-sm border border-line-soft bg-surface px-3 py-2">
              <span className="num text-[1.35rem] font-semibold text-zone-in-ink">120</span>
              <span className="ml-1 text-[0.8rem] text-ink-40">mg/dL</span>
            </div>
          </div>

          <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-40">{t('prefs.note')}</p>
        </div>
      )}
    </div>
  );
}
