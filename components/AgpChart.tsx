'use client';

import { GRID_LINES, Y_MAX, Y_MIN } from '@/lib/bands';
import { useElementWidth } from '@/lib/use-width';
import type { AgpBin } from '@/lib/types';

/**
 * The AGP: every day of the wear folded onto one 24-hour axis, showing the shape
 * of a typical day rather than any single day. It is the one picture that answers
 * "when does this happen to me" — which is the question a coach can act on.
 *
 * Bins built from too few readings are drawn faded, because a percentile band
 * computed from two points looks exactly as confident as one from two hundred.
 */

export default function AgpChart({ bins, height = 250 }: { bins: AgpBin[]; height?: number }) {
  const [wrapRef, measured] = useElementWidth<HTMLDivElement>(900);
  const W = Math.max(320, measured);
  const narrow = W < 520;
  const PAD = narrow
    ? { top: 8, right: 8, bottom: 24, left: 30 }
    : { top: 12, right: 14, bottom: 26, left: 38 };
  const usable = bins.filter((b) => b.p50 != null);
  if (usable.length < 4) {
    return (
      <p className="glass rounded-md p-5 text-[0.9rem] text-ink-70">
        ต้องมีข้อมูลอย่างน้อย 7 วันจึงจะรวมเป็นภาพวันปกติได้
      </p>
    );
  }

  const H = narrow ? Math.max(180, Math.round(height * 0.8)) : height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (min: number) => PAD.left + (min / 1440) * plotW;
  const y = (v: number) => {
    const c = Math.min(Y_MAX, Math.max(Y_MIN, v));
    return PAD.top + plotH - ((c - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;
  };

  const area = (lo: keyof AgpBin, hi: keyof AgpBin) => {
    const up: string[] = [];
    const down: string[] = [];
    for (const b of usable) {
      const h = b[hi] as number | null;
      const l = b[lo] as number | null;
      if (h == null || l == null) continue;
      up.push(`${x(b.minute).toFixed(1)},${y(h).toFixed(1)}`);
      down.unshift(`${x(b.minute).toFixed(1)},${y(l).toFixed(1)}`);
    }
    if (!up.length) return '';
    return `M${up.join(' L')} L${down.join(' L')} Z`;
  };

  const median = usable
    .filter((b) => b.p50 != null)
    .map((b, i) => `${i === 0 ? 'M' : 'L'}${x(b.minute).toFixed(1)},${y(b.p50 as number).toFixed(1)}`)
    .join(' ');

  const lowConf = usable.filter((b) => b.lowConfidence);

  return (
    <div ref={wrapRef} className="w-full">
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto', display: 'block' }} role="img"
      aria-label="ภาพรวมวันปกติ แสดงช่วงกระจายของน้ำตาลตามเวลาในแต่ละวัน">
      <rect x={PAD.left} y={y(180)} width={plotW} height={Math.max(0, y(70) - y(180))} fill="rgba(62,142,90,.08)" />

      {GRID_LINES.map((g) => (
        <g key={g}>
          <line x1={PAD.left} x2={PAD.left + plotW} y1={y(g)} y2={y(g)}
            stroke={g === 70 || g === 180 ? 'rgba(42,46,34,.26)' : 'rgba(42,46,34,.12)'}
            strokeWidth={g === 70 || g === 180 ? 1.1 : 0.8}
            strokeDasharray={g === 140 ? '4 4' : undefined} />
          <text x={PAD.left - 7} y={y(g) + 3.5} textAnchor="end" fontSize={narrow ? 10 : 10.5} fill="#68695F" className="num">{g}</text>
        </g>
      ))}

      {(narrow ? [0, 360, 720, 1080, 1440] : [0, 180, 360, 540, 720, 900, 1080, 1260, 1440]).map((min) => (
        <g key={min}>
          <line x1={x(min)} x2={x(min)} y1={PAD.top} y2={PAD.top + plotH} stroke="rgba(42,46,34,.07)" strokeWidth="0.8" />
          <text x={x(min)} y={H - 7} textAnchor="middle" fontSize={narrow ? 10 : 10.5} fill="#68695F" className="num">
            {String(Math.floor(min / 60) % 24).padStart(2, '0')}
          </text>
        </g>
      ))}

      <path d={area('p5', 'p95')} fill="rgba(46,68,32,.13)" />
      <path d={area('p25', 'p75')} fill="rgba(46,68,32,.26)" />
      <path d={median} fill="none" stroke="#2E4420" strokeWidth="2.2" strokeLinecap="round" />

      {lowConf.map((b) => (
        <rect key={b.minute} x={x(b.minute) - 2} y={PAD.top} width={4} height={plotH} fill="rgba(247,244,238,.55)" />
      ))}
    </svg>
    </div>
  );
}
