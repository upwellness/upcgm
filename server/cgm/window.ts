import type { AgpBin, DailyProfile, LowEvent, Metrics, Reading } from '@/lib/types';
import { computeAgp, computeDaily, computeMetrics, findLowEvents } from './metrics';
import { detectInterval, isMetricGrade } from './qc';
import { gateForWindow, type MetricGate } from './thresholds';

/**
 * A window is a slice of the wear, and every slice needs its own gate: the same
 * file yields a defensible 14-day report and a meaningless 3-hour GMI. Computing
 * slices here rather than in the browser keeps one definition of every metric —
 * the three different TIR definitions living in our older app are exactly what
 * happens when that rule is relaxed.
 *
 * Presets anchor to the last reading in the file, not to the current time: a
 * coach opening Monday's download on Thursday should still see "last 24 hours"
 * of wear, not an empty chart.
 */

export interface WindowSummary {
  key: string;
  labelTh: string;
  from: number;
  to: number;
  days: number;
  n: number;
  capturePct: number;
  /** null when the slice holds nothing usable — an empty chart, not a crash */
  metrics: Metrics | null;
  agp: AgpBin[];
  daily: DailyProfile[];
  lowEvents: LowEvent[];
  gate: MetricGate;
  /** true when the file is shorter than the window asked for */
  truncated: boolean;
}

export interface PresetDef {
  key: string;
  labelTh: string;
  shortTh: string;
  minutes: number;
}

export const PRESETS: PresetDef[] = [
  { key: '30d', labelTh: '30 วันล่าสุด', shortTh: '30 วัน', minutes: 30 * 1440 },
  { key: '14d', labelTh: '14 วันล่าสุด', shortTh: '14 วัน', minutes: 14 * 1440 },
  { key: '7d', labelTh: '7 วันล่าสุด', shortTh: '7 วัน', minutes: 7 * 1440 },
  { key: '3d', labelTh: '3 วันล่าสุด', shortTh: '3 วัน', minutes: 3 * 1440 },
  { key: '24h', labelTh: '24 ชั่วโมงล่าสุด', shortTh: '24 ชม.', minutes: 1440 },
  { key: '12h', labelTh: '12 ชั่วโมงล่าสุด', shortTh: '12 ชม.', minutes: 720 },
  { key: '6h', labelTh: '6 ชั่วโมงล่าสุด', shortTh: '6 ชม.', minutes: 360 },
  { key: '3h', labelTh: '3 ชั่วโมงล่าสุด', shortTh: '3 ชม.', minutes: 180 },
];

export function sliceReadings(readings: Reading[], from: number, to: number): Reading[] {
  // Inclusive on both ends: a reading exactly on the boundary belongs to the
  // window a coach just drew around it.
  return readings.filter((r) => r.t >= from && r.t <= to);
}

export function summarise(
  readings: Reading[],
  from: number,
  to: number,
  key: string,
  labelTh: string,
  opts?: { truncated?: boolean; intervalMinutes?: number },
): WindowSummary {
  const slice = sliceReadings(readings, from, to);
  const interval = opts?.intervalMinutes ?? (slice.length >= 3 ? detectInterval(slice) : 5);
  const spanMinutes = Math.max(0, to - from);
  const days = spanMinutes / 1440;

  const usable = slice.filter(isMetricGrade).length;
  const expected = spanMinutes > 0 ? Math.floor(spanMinutes / interval) + 1 : 0;
  const capturePct = expected > 0 ? Math.min(100, (usable / expected) * 100) : 0;

  return {
    key,
    labelTh,
    from,
    to,
    days,
    n: slice.length,
    capturePct,
    metrics: computeMetrics(slice),
    // AGP overlays every day on one 24-hour axis; below a week the percentile
    // bands are drawn from one or two points each and mislead more than they show.
    agp: days >= 7 ? computeAgp(slice) : [],
    daily: computeDaily(slice, interval),
    lowEvents: findLowEvents(slice),
    gate: gateForWindow(days, capturePct),
    truncated: opts?.truncated ?? false,
  };
}

export function presetWindows(readings: Reading[]): WindowSummary[] {
  if (readings.length === 0) return [];
  const last = readings[readings.length - 1].t;
  const first = readings[0].t;
  const interval = detectInterval(readings);

  const out: WindowSummary[] = [];
  for (const p of PRESETS) {
    const wanted = last - p.minutes;
    const from = Math.max(first, wanted);
    // Skip a preset that would show the same span as the whole file — offering
    // "30 days" and "14 days" that draw an identical 11-day chart makes the
    // coach doubt the tool rather than the data.
    const isWholeFile = from <= first;
    if (isWholeFile && out.some((w) => w.from <= first)) continue;
    out.push(summarise(readings, from, last, p.key, p.labelTh, { truncated: wanted < first, intervalMinutes: interval }));
  }
  return out;
}
