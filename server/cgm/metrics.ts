import { minuteOfDay, pctToMinutesPerDay, startOfDay } from '@/lib/time';
import { mealResponse } from '@/lib/meal-response';
import type { AgpBin, DailyProfile, LowEvent, Metrics, RangeBucket, Reading } from '@/lib/types';
import { isMetricGrade } from './qc';
import {
  DEVICE_FLOOR, MAX_ROC_PER_5MIN, MIN_DAYS_FOR_GMI,
  NIGHT_END_MIN, NIGHT_START_MIN,
} from './thresholds';

/**
 * One place decides which band a value belongs to. Every percentage is derived
 * from this function, which is what keeps TBR + TIR + TAR at exactly 100 and
 * stops two screens disagreeing about the same reading.
 *
 * Boundary convention, verified against the real file (which has readings
 * sitting exactly on 54, 70, 140 and 180): the in-range bands are inclusive of
 * both ends, and the out-of-range bands are strict.
 */
export type Band = 'tbr54' | 'tbr70' | 'tir' | 'tar180' | 'tar250';

export function classify(v: number): Band {
  if (v < 54) return 'tbr54';
  if (v < 70) return 'tbr70';
  if (v <= 180) return 'tir';
  if (v <= 250) return 'tar180';
  return 'tar250';
}

/** Linear interpolation, matching numpy's default and R type 7. */
export function quantile(sorted: number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

const pct = (count: number, total: number) => (total === 0 ? 0 : (count / total) * 100);

export function computeMetrics(all: Reading[]): Metrics | null {
  const rs = all.filter(isMetricGrade);
  if (rs.length === 0) return null;

  const values = rs.map((r) => r.v);
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;

  // Sample SD (n−1), the AGP convention. Declared here because Excel's STDEV.P
  // gives a different answer and someone will check by hand.
  const sd = n > 1
    ? Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1))
    : 0;
  const cv = mean === 0 ? 0 : (sd / mean) * 100;

  const sorted = [...values].sort((a, b) => a - b);

  let minAt = rs[0].t, maxAt = rs[0].t, min = rs[0].v, max = rs[0].v;
  for (const r of rs) {
    if (r.v < min) { min = r.v; minAt = r.t; }
    if (r.v > max) { max = r.v; maxAt = r.t; }
  }

  const counts: Record<Band, number> = { tbr54: 0, tbr70: 0, tir: 0, tar180: 0, tar250: 0 };
  for (const v of values) counts[classify(v)]++;

  const tbrUnder54 = pct(counts.tbr54, n);
  const tbrUnder70 = pct(counts.tbr54 + counts.tbr70, n);
  const tir = pct(counts.tir, n);
  const tar180to250 = pct(counts.tar180, n);
  const tarOver250 = pct(counts.tar250, n);
  const titr = pct(values.filter((v) => v >= 70 && v <= 140).length, n);

  const spanDays = (rs[rs.length - 1].t - rs[0].t) / 1440;
  const gmi = spanDays >= MIN_DAYS_FOR_GMI ? 3.31 + 0.02392 * mean : null;

  const night = rs.filter((r) => {
    const m = minuteOfDay(r.t);
    return m >= NIGHT_START_MIN && m < NIGHT_END_MIN;
  });
  const nightValues = night.map((r) => r.v);

  const buckets: RangeBucket[] = [
    { key: 'tbr54', labelTh: 'ต่ำมาก (ต่ำกว่า 54)', pct: tbrUnder54, minutesPerDay: pctToMinutesPerDay(tbrUnder54) },
    { key: 'tbr70', labelTh: 'ต่ำ (54–69)', pct: pct(counts.tbr70, n), minutesPerDay: pctToMinutesPerDay(pct(counts.tbr70, n)) },
    { key: 'tir', labelTh: 'อยู่ในเป้าหมาย (70–180)', pct: tir, minutesPerDay: pctToMinutesPerDay(tir) },
    { key: 'tar180', labelTh: 'สูง (181–250)', pct: tar180to250, minutesPerDay: pctToMinutesPerDay(tar180to250) },
    { key: 'tar250', labelTh: 'สูงมาก (มากกว่า 250)', pct: tarOver250, minutesPerDay: pctToMinutesPerDay(tarOver250) },
  ];

  return {
    n,
    firstT: rs[0].t,
    lastT: rs[rs.length - 1].t,
    mean,
    sd,
    cv,
    median: quantile(sorted, 0.5) ?? mean,
    p25: quantile(sorted, 0.25) ?? mean,
    p75: quantile(sorted, 0.75) ?? mean,
    min, max, minAt, maxAt,
    gmi,
    tir70_180: tir,
    titr70_140: titr,
    tbrUnder70,
    tbrUnder54,
    tar180to250,
    tarOver250,
    tarOver180: tar180to250 + tarOver250,
    nightTbrUnder70: nightValues.length ? pct(nightValues.filter((v) => v < 70).length, nightValues.length) : null,
    nightMean: nightValues.length ? nightValues.reduce((a, b) => a + b, 0) / nightValues.length : null,
    buckets,
  };
}

/**
 * 30-minute bins. At one reading per 5 minutes that is 6 per bin per day, so a
 * ten-day wear gives ~64 values — enough for the 5th and 95th percentile to sit
 * still. Five-minute bins would leave ~10 and the outer lines would jitter in a
 * way that reads as a bug.
 */
export const AGP_BIN_MINUTES = 30;

export function computeAgp(all: Reading[]): AgpBin[] {
  const binCount = 1440 / AGP_BIN_MINUTES;
  const bins: number[][] = Array.from({ length: binCount }, () => []);
  for (const r of all) {
    if (!isMetricGrade(r)) continue;
    bins[Math.floor(minuteOfDay(r.t) / AGP_BIN_MINUTES)].push(r.v);
  }
  return bins.map((arr, i) => {
    arr.sort((a, b) => a - b);
    return {
      minute: i * AGP_BIN_MINUTES,
      n: arr.length,
      lowConfidence: arr.length < 40,
      p5: quantile(arr, 0.05),
      p25: quantile(arr, 0.25),
      p50: quantile(arr, 0.5),
      p75: quantile(arr, 0.75),
      p95: quantile(arr, 0.95),
    };
  });
}

export function computeDaily(all: Reading[], intervalMinutes = 5): DailyProfile[] {
  const perDay = new Map<number, Reading[]>();
  for (const r of all) {
    const day = startOfDay(r.t);
    const list = perDay.get(day);
    if (list) list.push(r); else perDay.set(day, [r]);
  }
  const expectedPerDay = 1440 / intervalMinutes;

  return [...perDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayStart, list]) => {
      const usable = list.filter(isMetricGrade);
      const values = usable.map((r) => r.v);
      const capturePct = (list.length / expectedPerDay) * 100;
      const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      return {
        dayStart,
        n: list.length,
        capturePct,
        // A first or last day that only holds a few hours cannot be compared
        // with a full one, so it is marked rather than quietly averaged in.
        partial: capturePct < 70,
        mean,
        tir70_180: pct(values.filter((v) => classify(v) === 'tir').length, values.length),
        tbrUnder70: pct(values.filter((v) => v < 70).length, values.length),
        tarOver180: pct(values.filter((v) => v > 180).length, values.length),
        hasVeryLow: values.some((v) => v < 54),
      };
    });
}

/**
 * Group consecutive low readings into events. A number on its own says nothing
 * about whether it mattered — 46 minutes below 54 in one stretch is a different
 * conversation from nine isolated dips, and only the event view shows which.
 */
export function findLowEvents(all: Reading[], threshold = 70): LowEvent[] {
  const rs = all.filter(isMetricGrade);
  const events: LowEvent[] = [];
  let i = 0;
  while (i < rs.length) {
    if (rs[i].v >= threshold) { i++; continue; }
    let j = i;
    let nadir = rs[i].v;
    while (j < rs.length && rs[j].v < threshold) { nadir = Math.min(nadir, rs[j].v); j++; }

    const before = i > 0 ? rs[i - 1].v : null;
    const entryDrop = before == null ? null : before - rs[i].v;
    const from = rs[i].t, to = rs[j - 1].t;
    const startMin = minuteOfDay(from);

    events.push({
      from, to,
      minutes: (to - from) + 5,
      nadir,
      count: j - i,
      level: nadir < 54 ? 'level2' : 'level1',
      overnight: startMin >= NIGHT_START_MIN && startMin < NIGHT_END_MIN,
      entryDrop,
      // Steep entry, brief, and back up on its own — the pattern of lying on the
      // sensor. Surfaced as a question, never as a verdict: if the wearer takes
      // insulin the safe reading is to treat it as real.
      suspectedCompression:
        (entryDrop != null && entryDrop > MAX_ROC_PER_5MIN) ||
        (nadir <= DEVICE_FLOOR && j - i <= 3),
    });
    i = j;
  }
  return events;
}

/**
 * Re-exported from lib/meal-response.ts so the server and the browser compute a
 * post-meal response with the same code. See the note in that file.
 */
export function computeMealResponse(markerT: number, all: Reading[]) {
  const { markerId: _ignored, ...rest } = mealResponse('', markerT, all);
  return rest;
}
