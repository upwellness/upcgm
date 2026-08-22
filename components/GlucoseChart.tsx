'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePrefs, useT } from './PrefsProvider';
import { useElementWidth } from '@/lib/use-width';
import { BANDS, GRID_LINES, Y_MAX, Y_MIN, bandOf } from '@/lib/bands';
import { seriesPath, type Pt } from '@/lib/curve';
import { clampView, pinchView } from '@/lib/zoom';
import { fmtDateTime, fmtDuration, fmtTime, minuteOfDay } from '@/lib/time';
import type { Flag, MealMarker } from '@/lib/types';

interface Props {
  t: number[];
  v: number[];
  flag: Flag[];
  from: number;
  to: number;
  markers?: MealMarker[];
  /** minutes; a bigger hole than this breaks the line instead of bridging it */
  gapMinutes?: number;
  height?: number;
  onMarkerClick?: (id: string) => void;
  /**
   * Offered when the reader has zoomed in: recompute every number on the page
   * for the span they are looking at. Without it a zoom is only ever a closer
   * look at figures that still belong to the wider window.
   */
  onFocusRange?: (from: number, to: number) => void;
  /**
    * The standing "drag to zoom" line. On the small chart inside an event row it
    * is noise — the gestures still work there, and the row that says what is
    * zoomed and how to get back appears the moment someone uses them.
    */
  showHint?: boolean;
  /** print/export mode: no interaction, no hover layer, no zoom */
  staticMode?: boolean;
}

const MARKER_LANE = 22;

/** Narrow screens get a tighter gutter; 40px of left padding on a 390px phone is
 *  a tenth of the chart spent on three digits. */
const padFor = (w: number) =>
  w < 520
    ? { top: 10, right: 10, bottom: 26, left: 30 }
    : { top: 14, right: 16, bottom: 30, left: 40 };

type Gesture =
  | { kind: 'pinch'; startDist: number; startSpan: number; anchorT: number }
  | { kind: 'select'; startVx: number }
  | null;

export default function GlucoseChart({
  t, v, flag, from, to, markers = [], gapMinutes = 20, height = 300,
  onMarkerClick, onFocusRange, showHint = true, staticMode = false,
}: Props) {
  const tr = useT();
  const { prefs: { locale } } = usePrefs();
  const [wrapRef, measured] = useElementWidth<HTMLDivElement>(900);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // useId() hands back something like «r7» or :r7:. Those are legal HTML ids but
  // this SVG gets serialised to XML on its way into the exported PNG, where the
  // punctuation is not — so it is stripped down to letters and digits here.
  const clipId = `clip${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  // The zoom is a view on the same data, not a new analysis: every number
  // elsewhere on the page still belongs to the window the coach picked. That is
  // why zooming offers "focus on this range" rather than silently redefining it.
  const [view, setView] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => { setView(null); }, [from, to]);

  const vFrom = view ? view.from : from;
  const vTo = view ? view.to : to;

  // One viewBox unit = one CSS pixel, so every label renders at its stated size
  // on the device it is being read on.
  const W = Math.max(320, measured);
  const narrow = W < 520;
  const PAD = padFor(W);
  const H = narrow ? Math.max(210, Math.round(height * 0.78)) : height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom - (markers.length ? MARKER_LANE : 0);

  const span = Math.max(1, vTo - vFrom);
  const x = (tt: number) => PAD.left + ((tt - vFrom) / span) * plotW;
  const y = (vv: number) => {
    const clamped = Math.min(Y_MAX, Math.max(Y_MIN, vv));
    return PAD.top + plotH - ((clamped - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;
  };

  // ---- view changes, coalesced to one per frame -------------------------
  // A pinch fires pointermove far faster than the browser paints, and each one
  // rebuilds a path over every reading in the window. Without this the gesture
  // stutters on a phone at exactly the moment it needs to feel direct.
  const raf = useRef<number | null>(null);
  const pending = useRef<{ from: number; to: number } | null | undefined>(undefined);

  const flush = useCallback(() => {
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; }
    if (pending.current !== undefined) { setView(pending.current); pending.current = undefined; }
  }, []);

  /**
   * `now` is for anything the reader finished doing — letting go of a drag,
   * pressing a key, hitting reset. Those must not wait on a paint frame: a
   * background tab throttles rAF to nothing, and the zoom would simply be lost.
   * Only the continuous stream of a pinch is coalesced.
   */
  const commit = useCallback((next: { from: number; to: number } | null, now = false) => {
    pending.current = next;
    if (now) { flush(); return; }
    if (raf.current != null) return;
    raf.current = requestAnimationFrame(() => { raf.current = null; flush(); });
  }, [flush]);
  useEffect(() => () => { if (raf.current != null) cancelAnimationFrame(raf.current); }, []);

  // Both of these clamp to the window and collapse "the whole thing" to null —
  // see lib/zoom.ts, where the arithmetic is tested on its own.
  const applyView = useCallback((nextFrom: number, nextSpan: number, now = false) => {
    commit(clampView({ from, to }, nextFrom, nextSpan), now);
  }, [from, to, commit]);

  const applyPinch = useCallback((startSpan: number, anchorT: number, scale: number, frac: number) => {
    commit(pinchView({ from, to }, startSpan, anchorT, scale, frac));
  }, [from, to, commit]);

  // ---- gestures ---------------------------------------------------------
  const ptrs = useRef(new Map<number, number>());   // pointerId → clientX
  const gesture = useRef<Gesture>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);

  const toVx = (clientX: number, rect: DOMRect) => ((clientX - rect.left) / rect.width) * W;
  const vxToT = (vx: number) => vFrom + ((vx - PAD.left) / plotW) * span;

  const visible = useMemo(() => {
    const idx: number[] = [];
    for (let i = 0; i < t.length; i++) if (t[i] >= vFrom && t[i] <= vTo) idx.push(i);
    return idx;
  }, [t, vFrom, vTo]);

  const scrubTo = (vx: number) => {
    if (visible.length === 0) return;
    const target = vxToT(vx);
    let best = visible[0];
    let bestD = Infinity;
    for (const i of visible) {
      const d = Math.abs(t[i] - target);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover({ i: best, x: x(t[best]), y: y(v[best]) });
  };

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (staticMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    ptrs.current.set(e.pointerId, e.clientX);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }

    if (ptrs.current.size >= 2) {
      const xs = [...ptrs.current.values()];
      const dist = Math.max(1, Math.abs(xs[0] - xs[1]));
      const midVx = toVx((xs[0] + xs[1]) / 2, rect);
      // The time under the midpoint is held still for the whole gesture, so the
      // reading someone pinched around is the one still under their fingers.
      gesture.current = { kind: 'pinch', startDist: dist, startSpan: span, anchorT: vxToT(midVx) };
      setHover(null);
      setSel(null);
    } else if (e.pointerType === 'mouse') {
      // On a mouse a drag draws the range to zoom into. On touch one finger is
      // left alone for reading values — the gesture people already know from a
      // phone health app — and zooming is the two-finger job.
      gesture.current = { kind: 'select', startVx: toVx(e.clientX, rect) };
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (staticMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, e.clientX);
    const g = gesture.current;

    if (g?.kind === 'pinch') {
      if (ptrs.current.size < 2) return;
      const xs = [...ptrs.current.values()];
      const dist = Math.max(1, Math.abs(xs[0] - xs[1]));
      const midVx = toVx((xs[0] + xs[1]) / 2, rect);
      // Two fingers moving together without changing distance is a pan, and
      // the same call handles it: the anchor slides with the midpoint.
      applyPinch(g.startSpan, g.anchorT, dist / g.startDist, (midVx - PAD.left) / plotW);
      return;
    }

    if (g?.kind === 'select') {
      const vx = toVx(e.clientX, rect);
      if (Math.abs(vx - g.startVx) > 4) {
        setSel({ a: g.startVx, b: vx });
        setHover(null);
        return;
      }
    }

    scrubTo(toVx(e.clientX, rect));
  }

  function endPointer(e: React.PointerEvent<SVGSVGElement>) {
    if (staticMode) return;
    const g = gesture.current;
    ptrs.current.delete(e.pointerId);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already gone */ }

    if (g?.kind === 'select' && sel) {
      const a = Math.min(sel.a, sel.b);
      const b = Math.max(sel.a, sel.b);
      // Under about eight pixels this was a click, not a drag. Zooming on it
      // would fire on every stray click on the chart.
      if (b - a > 8) applyView(vxToT(a), vxToT(b) - vxToT(a), true);
      setSel(null);
    }
    // Whatever the last pinch frame worked out, land it — the gesture is over
    // and there may be no further frame coming.
    if (ptrs.current.size < 2) { gesture.current = null; flush(); }
  }

  function onPointerCancel(e: React.PointerEvent<SVGSVGElement>) {
    // The browser took the gesture for a page scroll. Drop ours cleanly rather
    // than leaving a half-drawn selection on screen.
    ptrs.current.delete(e.pointerId);
    gesture.current = null;
    setSel(null);
  }

  // A trackpad pinch arrives as a wheel event with ctrlKey set. React registers
  // wheel passively at the root, so preventDefault only works from a listener
  // attached here by hand. A plain wheel is left alone — the page must scroll.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || staticMode) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const frac = (((e.clientX - rect.left) / rect.width) * W - PAD.left) / plotW;
      // A trackpad pinch reports negative deltaY when the fingers spread, so
      // this reads as "spread to zoom in", the same direction as the touch one.
      applyPinch(span, vFrom + frac * span, Math.exp(-e.deltaY * 0.01), frac);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [W, PAD.left, plotW, vFrom, span, applyPinch, staticMode]);

  function onKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    if (staticMode) return;
    const mid = vFrom + span / 2;
    const step = span * 0.2;
    if (e.key === '+' || e.key === '=') { applyView(mid - span * 0.35, span * 0.7, true); }
    else if (e.key === '-' || e.key === '_') { applyView(mid - span * 0.71, span * 1.42, true); }
    else if (e.key === '0' || e.key === 'Escape') { commit(null, true); }
    else if (e.key === 'ArrowLeft') { applyView(vFrom - step, span, true); }
    else if (e.key === 'ArrowRight') { applyView(vFrom + step, span, true); }
    else return;
    e.preventDefault();
    setHover(null);
  }

  // ---- geometry ---------------------------------------------------------
  const { paths, points, outOfAxis } = useMemo(() => {
    // One reading either side of the view, so a zoomed line runs to both edges
    // instead of stopping short of them with a suspicious gap.
    let lo = 0;
    while (lo < t.length && t[lo] < vFrom) lo++;
    let hi = t.length - 1;
    while (hi >= 0 && t[hi] > vTo) hi--;
    lo = Math.max(0, lo - 1);
    hi = Math.min(t.length - 1, hi + 1);

    const segs: Pt[][] = [];
    const pts: Array<{ i: number; cx: number; cy: number; flag: Flag; v: number }> = [];
    const out: Array<{ cx: number; above: boolean }> = [];
    let current: Pt[] = [];
    let prevT: number | null = null;

    for (let i = lo; i <= hi; i++) {
      const cx = x(t[i]);
      const cy = y(v[i]);

      // A break in the line is information: it says the sensor was not reporting.
      // Bridging it draws a straight ramp through hours that never happened.
      const broke = prevT != null && t[i] - prevT > gapMinutes;
      if (broke && current.length) { segs.push(current); current = []; }

      // Excluded readings are drawn as dots only — visible, but never part of a
      // line that implies the body went there.
      if (flag[i] === 'ok' || flag[i] === 'censored') {
        current.push({ x: cx, y: cy });
      } else if (current.length) {
        segs.push(current);
        current = [];
      }

      if (v[i] > Y_MAX || v[i] < Y_MIN) out.push({ cx, above: v[i] > Y_MAX });
      if (flag[i] !== 'ok') pts.push({ i, cx, cy, flag: flag[i], v: v[i] });
      prevT = t[i];
    }
    if (current.length) segs.push(current);

    return {
      paths: segs.map((s) => seriesPath(s, plotW)),
      points: pts,
      outOfAxis: out,
    };
  }, [t, v, flag, vFrom, vTo, gapMinutes, plotW, plotH, PAD.left, PAD.top, W]);

  const ticks = useMemo(() => buildTicks(vFrom, vTo, narrow ? 5 : 8), [vFrom, vTo, narrow]);
  const laneY = PAD.top + plotH + 6;

  const hv = hover && hover.i < t.length ? { t: t[hover.i], v: v[hover.i], flag: flag[hover.i] } : null;
  const tipLeft = hover ? Math.min(Math.max(hover.x / W, 0.06), 0.94) * 100 : 0;
  const zoomed = view != null;

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={`w-full touch-pan-y ${staticMode ? '' : 'cursor-crosshair focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60'}`}
        style={{ height: 'auto', display: 'block' }}
        role="img"
        tabIndex={staticMode ? undefined : 0}
        aria-label={tr(
          `กราฟน้ำตาลตั้งแต่ ${fmtDateTime(vFrom)} ถึง ${fmtDateTime(vTo)}${staticMode ? '' : ' — ปุ่มบวกลบเพื่อซูม ลูกศรซ้ายขวาเพื่อเลื่อน เลข 0 เพื่อกลับไปดูทั้งช่วง'}`,
          `Glucose from ${fmtDateTime(vFrom)} to ${fmtDateTime(vTo)}${staticMode ? '' : ' — plus and minus to zoom, left and right arrows to pan, 0 for the whole window'}`,
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => { if (!gesture.current) setHover(null); }}
        onDoubleClick={staticMode ? undefined : () => commit(null, true)}
        onKeyDown={onKeyDown}
      >
        <defs>
          <clipPath id={`${clipId}-plot`}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
          <clipPath id={`${clipId}-col`}>
            <rect x={PAD.left} y={0} width={plotW} height={H} />
          </clipPath>
        </defs>

        {/* zone washes: the reader should know which third of the chart is target
            range without reading a single axis label */}
        {BANDS.map((b) => {
          const lo = b.lo ?? Y_MIN;
          const hi = b.hi ?? Y_MAX;
          if (hi <= Y_MIN || lo >= Y_MAX) return null;
          const yTop = y(Math.min(hi, Y_MAX));
          const yBot = y(Math.max(lo, Y_MIN));
          return <rect key={b.key} x={PAD.left} y={yTop} width={plotW} height={Math.max(0, yBot - yTop)} fill={b.wash} />;
        })}

        {GRID_LINES.map((g) => (
          <g key={g}>
            <line
              x1={PAD.left} x2={PAD.left + plotW} y1={y(g)} y2={y(g)}
              stroke={g === 70 || g === 180 ? 'rgba(42,46,34,.28)' : 'rgba(42,46,34,.13)'}
              strokeWidth={g === 70 || g === 180 ? 1.1 : 0.8}
              strokeDasharray={g === 140 ? '4 4' : undefined}
            />
            <text x={PAD.left - 7} y={y(g) + 3.5} textAnchor="end" fontSize={narrow ? 10 : 10.5} fill="rgb(var(--c-ink-70))" className="num">{g}</text>
          </g>
        ))}

        {ticks.map((tk) => (
          <g key={tk.t}>
            <line x1={x(tk.t)} x2={x(tk.t)} y1={PAD.top} y2={PAD.top + plotH} stroke="rgba(42,46,34,.07)" strokeWidth="0.8" />
            <text x={x(tk.t)} y={H - 8} textAnchor="middle" fontSize={narrow ? 10 : 10.5} fill="rgb(var(--c-ink-70))">{tk.label}</text>
          </g>
        ))}

        <g clipPath={`url(#${clipId}-plot)`}>
          {paths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="rgb(var(--c-olive-dark))" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          ))}

          {points.map((p) => (
            <circle
              key={`${p.i}-${p.flag}`}
              cx={p.cx} cy={p.cy} r={2.6}
              fill="none"
              stroke={p.flag === 'censored' ? bandOf(p.v).fill : 'rgb(var(--c-ink-40))'}
              strokeWidth="1.4"
              strokeDasharray={p.flag === 'censored' ? undefined : '2 1.6'}
            />
          ))}

          {outOfAxis.map((o, i) => (
            <path
              key={i}
              d={o.above ? `M${o.cx - 4},${PAD.top + 5} L${o.cx},${PAD.top} L${o.cx + 4},${PAD.top + 5}` : `M${o.cx - 4},${PAD.top + plotH - 5} L${o.cx},${PAD.top + plotH} L${o.cx + 4},${PAD.top + plotH - 5}`}
              fill="none" stroke={o.above ? 'rgb(var(--c-zone-vhigh))' : 'rgb(var(--c-zone-vlow))'} strokeWidth="1.6" strokeLinecap="round"
            />
          ))}
        </g>

        {markers.length > 0 && (
          <g clipPath={`url(#${clipId}-col)`}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={laneY} y2={laneY} stroke="rgba(42,46,34,.10)" strokeWidth="0.8" />
            {markers
              .filter((mk) => mk.t >= vFrom && mk.t <= vTo)
              .map((mk) => (
                <g
                  key={mk.id}
                  className={staticMode ? undefined : 'cursor-pointer'}
                  onClick={staticMode ? undefined : () => onMarkerClick?.(mk.id)}
                  role={staticMode ? undefined : 'button'}
                  aria-label={staticMode ? undefined : tr(`มื้อ ${mk.label} เวลา ${fmtTime(mk.t)}`, `Meal ${mk.label} at ${fmtTime(mk.t)}`)}
                >
                  <line x1={x(mk.t)} x2={x(mk.t)} y1={PAD.top} y2={laneY} stroke="rgb(var(--c-gold-ink))" strokeWidth="1" strokeDasharray="3 3" />
                  <circle cx={x(mk.t)} cy={laneY + 7} r={narrow ? 8 : 6} fill="rgb(var(--c-gold))" />
                  <text x={x(mk.t)} y={laneY + 10.5} textAnchor="middle" fontSize={narrow ? 9.5 : 8} fill="rgb(var(--c-ink))" fontWeight="600">
                    {mk.label.slice(0, 1)}
                  </text>
                </g>
              ))}
          </g>
        )}

        {sel && (
          <g pointerEvents="none">
            <rect
              x={Math.min(sel.a, sel.b)} y={PAD.top}
              width={Math.abs(sel.b - sel.a)} height={plotH}
              fill="rgb(var(--c-olive) / 0.16)" stroke="rgb(var(--c-olive-dark))" strokeWidth="1"
            />
          </g>
        )}

        {hover && hv && (
          <g pointerEvents="none" clipPath={`url(#${clipId}-col)`}>
            <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={PAD.top + plotH} stroke="rgba(42,46,34,.35)" strokeWidth="1" />
            <circle cx={hover.x} cy={hover.y} r={4.5} fill="#fff" stroke={bandOf(hv.v).fill} strokeWidth="2.2" />
          </g>
        )}
      </svg>

      {hover && hv && (
        <div
          className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-sm bg-tooltip/95 px-2.5 py-1.5 text-[0.76rem] leading-tight text-accent-ink shadow-md"
          style={{ left: `${tipLeft}%` }}
        >
          <div className="num font-semibold">{hv.v} {tr('มก./ดล.', 'mg/dL')}</div>
          <div className="opacity-80">{fmtDateTime(hv.t)}</div>
          {hv.flag !== 'ok' && <div className="mt-0.5 text-[0.7rem] text-gold">{flagLabel(hv.flag, tr)}</div>}
        </div>
      )}

      {!staticMode && (zoomed || showHint) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.76rem] text-ink-70">
          {zoomed ? (
            <>
              <span className="num">
                {fmtDateTime(vFrom)} – {fmtDateTime(vTo)}
                <span className="ml-1.5 text-ink-70">({fmtDuration(Math.round(span), locale)})</span>
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                {onFocusRange && (
                  <button
                    type="button"
                    onClick={() => onFocusRange(Math.round(vFrom), Math.round(vTo))}
                    className="min-h-[2rem] rounded-full bg-accent px-3 text-[0.76rem] font-medium text-accent-ink transition hover:opacity-90"
                  >
                    {tr('คิดตัวเลขเฉพาะช่วงนี้', 'Recompute for this range')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => commit(null, true)}
                  className="min-h-[2rem] rounded-full border border-line bg-surface-raised px-3 text-[0.76rem] font-medium transition hover:bg-surface-sunken"
                >
                  {tr('ดูทั้งช่วง', 'Whole window')}
                </button>
              </span>
            </>
          ) : (
            <span>
              {tr(
                'ลากบนกราฟเพื่อเลือกช่วงที่อยากดูใกล้ ๆ · บนมือถือใช้สองนิ้วจีบเข้า-ออก · แตะค้างแล้วลากเพื่ออ่านค่า',
                'Drag across the chart to look closer · pinch with two fingers on a phone · press and drag to read values',
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function flagLabel(f: Flag, tr: (th: string, en: string) => string): string {
  if (f === 'censored') {
    return tr('ค่าต่ำสุดที่เครื่องรายงานได้ — ของจริงอาจต่ำกว่านี้', 'The lowest the device can report — the real value may be lower');
  }
  if (f === 'artifact') {
    return tr('ไม่นับในการคำนวณ · เซนเซอร์น่าจะหลุดหรือถูกกดทับ', 'Not counted · the sensor was probably loose or lain on');
  }
  return tr('ไม่นับในการคำนวณ · ค่ากระโดดผิดปกติ', 'Not counted · the reading jumped further than a body can');
}

/** Six to eight ticks, spaced on a unit a human reads: hours, then days. */
function buildTicks(from: number, to: number, maxTicks = 8): Array<{ t: number; label: string }> {
  const span = to - from;
  const steps = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320, 10080];
  const step = steps.find((s) => span / s <= maxTicks) ?? Math.ceil(span / maxTicks);
  const out: Array<{ t: number; label: string }> = [];
  const first = Math.ceil(from / step) * step;
  for (let tt = first; tt <= to; tt += step) {
    out.push({
      t: tt,
      label: step >= 1440 ? shortDate(tt) : minuteOfDay(tt) === 0 ? shortDate(tt) : fmtTime(tt),
    });
  }
  return out;
}

function shortDate(t: number): string {
  const d = new Date(t * 60000);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}
