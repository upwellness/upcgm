'use client';

import { useMemo, useState } from 'react';
import { useElementWidth } from '@/lib/use-width';
import { BANDS, GRID_LINES, Y_MAX, Y_MIN, bandOf } from '@/lib/bands';
import { fmtDateTime, fmtTime, minuteOfDay } from '@/lib/time';
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
  /** print/export mode: no interaction, no hover layer */
  staticMode?: boolean;
}

const MARKER_LANE = 22;
/** Narrow screens get a tighter gutter; 40px of left padding on a 390px phone is
 *  a tenth of the chart spent on three digits. */
const padFor = (w: number) =>
  w < 520
    ? { top: 10, right: 10, bottom: 26, left: 30 }
    : { top: 14, right: 16, bottom: 30, left: 40 };

export default function GlucoseChart({
  t, v, flag, from, to, markers = [], gapMinutes = 20, height = 300, onMarkerClick, staticMode = false,
}: Props) {
  const [wrapRef, measured] = useElementWidth<HTMLDivElement>(900);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  // One viewBox unit = one CSS pixel, so every label renders at its stated size
  // on the device it is being read on.
  const W = Math.max(320, measured);
  const narrow = W < 520;
  const PAD = padFor(W);
  const H = narrow ? Math.max(210, Math.round(height * 0.78)) : height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom - (markers.length ? MARKER_LANE : 0);

  const span = Math.max(1, to - from);
  const x = (tt: number) => PAD.left + ((tt - from) / span) * plotW;
  const y = (vv: number) => {
    const clamped = Math.min(Y_MAX, Math.max(Y_MIN, vv));
    return PAD.top + plotH - ((clamped - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;
  };

  const { segments, points, outOfAxis } = useMemo(() => {
    const segs: string[] = [];
    const pts: Array<{ i: number; cx: number; cy: number; flag: Flag; v: number; t: number }> = [];
    const out: Array<{ cx: number; cy: number; above: boolean; v: number }> = [];
    let current: string[] = [];
    let prevT: number | null = null;

    for (let i = 0; i < t.length; i++) {
      if (t[i] < from || t[i] > to) continue;
      const cx = x(t[i]);
      const cy = y(v[i]);

      // A break in the line is information: it says the sensor was not reporting.
      // Bridging it draws a straight ramp through hours that never happened.
      const broke = prevT != null && t[i] - prevT > gapMinutes;
      if (broke && current.length) {
        segs.push(current.join(' '));
        current = [];
      }

      // Excluded readings are drawn as dots only — visible, but never part of a
      // line that implies the body went there.
      if (flag[i] === 'ok' || flag[i] === 'censored') {
        current.push(`${current.length === 0 ? 'M' : 'L'}${cx.toFixed(1)},${cy.toFixed(1)}`);
      } else if (current.length) {
        segs.push(current.join(' '));
        current = [];
      }

      if (v[i] > Y_MAX || v[i] < Y_MIN) out.push({ cx, cy, above: v[i] > Y_MAX, v: v[i] });
      if (flag[i] !== 'ok') pts.push({ i, cx, cy, flag: flag[i], v: v[i], t: t[i] });
      prevT = t[i];
    }
    if (current.length) segs.push(current.join(' '));
    return { segments: segs, points: pts, outOfAxis: out };
  }, [t, v, flag, from, to, gapMinutes, height, markers.length, W, H]);

  const visible = useMemo(() => {
    const idx: number[] = [];
    for (let i = 0; i < t.length; i++) if (t[i] >= from && t[i] <= to) idx.push(i);
    return idx;
  }, [t, from, to]);

  const ticks = useMemo(() => buildTicks(from, to, narrow ? 5 : 8), [from, to, narrow]);
  const laneY = PAD.top + plotH + 6;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (staticMode || visible.length === 0) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    // Map the pointer back through the viewBox scale, otherwise the readout is
    // off by the ratio between CSS width and 900.
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const target = from + ((vx - PAD.left) / plotW) * span;
    let best = visible[0];
    let bestD = Infinity;
    for (const i of visible) {
      const d = Math.abs(t[i] - target);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover({ i: best, x: x(t[best]), y: y(v[best]) });
  }

  const hv = hover ? { t: t[hover.i], v: v[hover.i], flag: flag[hover.i] } : null;
  const tipLeft = hover ? Math.min(Math.max(hover.x / W, 0.06), 0.94) * 100 : 0;

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-pan-y"
        style={{ height: 'auto', display: 'block' }}
        role="img"
        aria-label={`กราฟน้ำตาลตั้งแต่ ${fmtDateTime(from)} ถึง ${fmtDateTime(to)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
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

        {segments.map((d, i) => (
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

        {markers.length > 0 && (
          <g>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={laneY} y2={laneY} stroke="rgba(42,46,34,.10)" strokeWidth="0.8" />
            {markers
              .filter((mk) => mk.t >= from && mk.t <= to)
              .map((mk) => (
                <g
                  key={mk.id}
                  className={staticMode ? undefined : 'cursor-pointer'}
                  onClick={staticMode ? undefined : () => onMarkerClick?.(mk.id)}
                  role={staticMode ? undefined : 'button'}
                  aria-label={staticMode ? undefined : `มื้อ ${mk.label} เวลา ${fmtTime(mk.t)}`}
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

        {hover && hv && (
          <g pointerEvents="none">
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
          <div className="num font-semibold">{hv.v} มก./ดล.</div>
          <div className="opacity-80">{fmtDateTime(hv.t)}</div>
          {hv.flag !== 'ok' && <div className="mt-0.5 text-[0.7rem] text-gold">{flagLabel(hv.flag)}</div>}
        </div>
      )}
    </div>
  );
}

function flagLabel(f: Flag): string {
  if (f === 'censored') return 'ค่าต่ำสุดที่เครื่องรายงานได้ — ของจริงอาจต่ำกว่านี้';
  if (f === 'artifact') return 'ไม่นับในการคำนวณ · เซนเซอร์น่าจะหลุดหรือถูกกดทับ';
  return 'ไม่นับในการคำนวณ · ค่ากระโดดผิดปกติ';
}

/** Six to eight ticks, spaced on a unit a human reads: hours, then days. */
function buildTicks(from: number, to: number, maxTicks = 8): Array<{ t: number; label: string }> {
  const span = to - from;
  const steps = [15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320, 10080];
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
