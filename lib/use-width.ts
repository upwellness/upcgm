'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Charts here draw into a viewBox sized to the element's real CSS width, so one
 * viewBox unit is one CSS pixel and `fontSize="11"` renders as 11px on a phone.
 * With a fixed 900-unit viewBox, the same label lands at about 4.6px on a 390px
 * screen — legible in a screenshot at desktop size, unreadable on the device
 * where a coach actually opens this.
 *
 * Returns the fallback until the first measurement so server output and the first
 * client paint agree.
 */
export function useElementWidth<T extends HTMLElement>(fallback = 900) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', apply);
      return () => window.removeEventListener('resize', apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}
