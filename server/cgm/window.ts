import type { AgpBin, DailyProfile, LowEvent, Metrics, Reading } from '@/lib/types';
import { tx, type Locale } from './i18n';
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

export const presets = (locale: Locale): PresetDef[] => {
  const t = tx(locale);
  const d = (n: number) => t(`${n} วันล่าสุด`, `Last ${n} days`);
  const ds = (n: number) => t(`${n} วัน`, `${n}d`);
  const h = (n: number) => t(`${n} ชั่วโมงล่าสุด`, `Last ${n} hours`);
  const hs = (n: number) => t(`${n} ชม.`, `${n}h`);
  return [
    { key: '30d', labelTh: d(30), shortTh: ds(30), minutes: 30 * 1440 },
    { key: '14d', labelTh: d(14), shortTh: ds(14), minutes: 14 * 1440 },
    { key: '7d', labelTh: d(7), shortTh: ds(7), minutes: 7 * 1440 },
    { key: '3d', labelTh: d(3), shortTh: ds(3), minutes: 3 * 1440 },
    { key: '24h', labelTh: h(24), shortTh: hs(24), minutes: 1440 },
    { key: '12h', labelTh: h(12), shortTh: hs(12), minutes: 720 },
    { key: '6h', labelTh: h(6), shortTh: hs(6), minutes: 360 },
    { key: '3h', labelTh: h(3), shortTh: hs(3), minutes: 180 },
  ];
};

/** @deprecated Thai-only snapshot; call presets(locale) instead. */
export const PRESETS: PresetDef[] = presets('th');

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
  opts?: { truncated?: boolean; intervalMinutes?: number; locale?: Locale },
): WindowSummary {
  const locale = opts?.locale ?? 'th';
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
    metrics: computeMetrics(slice, locale),
    // AGP overlays every day on one 24-hour axis; below a week the percentile
    // bands are drawn from one or two points each and mislead more than they show.
    agp: days >= 7 ? computeAgp(slice) : [],
    daily: computeDaily(slice, interval),
    lowEvents: findLowEvents(slice),
    gate: gateForWindow(days, capturePct, locale),
    truncated: opts?.truncated ?? false,
  };
}

export function presetWindows(readings: Reading[], locale: Locale = 'th'): WindowSummary[] {
  if (readings.length === 0) return [];
  const last = readings[readings.length - 1].t;
  const first = readings[0].t;
  const interval = detectInterval(readings);

  const out: WindowSummary[] = [];
  for (const p of presets(locale)) {
    const wanted = last - p.minutes;
    const from = Math.max(first, wanted);
    // Skip a preset that would show the same span as the whole file — offering
    // "30 days" and "14 days" that draw an identical 11-day chart makes the
    // coach doubt the tool rather than the data.
    const isWholeFile = from <= first;
    if (isWholeFile && out.some((w) => w.from <= first)) continue;
    out.push(summarise(readings, from, last, p.key, p.labelTh, { locale, truncated: wanted < first, intervalMinutes: interval }));
  }
  return out;
}
