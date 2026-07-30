import type { MealResponse, Reading } from './types';

/**
 * Lives in lib/ rather than server/ because both sides need it: the screen shows
 * a response the moment a coach drops a marker, and the A4 sheet is rendered from
 * the same numbers. One implementation, imported by both — the alternative is two
 * copies that drift, which is precisely how our older app ended up printing three
 * different values for time-in-range.
 *
 * It is plain arithmetic with no interpretation in it, so nothing of value leaks
 * by having it in the bundle.
 */

/** Only 'ok' and 'censored' readings feed the maths — mirrors server/cgm/qc.ts. */
const usable = (r: Reading) => r.flag === 'ok' || r.flag === 'censored';

export const PRE_MEAL_MINUTES = 15;
export const POST_MEAL_MINUTES = 180;
/** Within 10 mg/dL of baseline counts as "back down" — sensor noise is ±10-ish. */
export const BASELINE_TOLERANCE = 10;

export function mealResponse(markerId: string, markerT: number, all: Reading[]): MealResponse {
  const rs = all.filter(usable);
  const pre = rs.filter((r) => r.t >= markerT - PRE_MEAL_MINUTES && r.t <= markerT);
  const win = rs.filter((r) => r.t >= markerT && r.t <= markerT + POST_MEAL_MINUTES);

  if (win.length < 3) {
    return { markerId, baseline: null, peak: null, peakAt: null, delta: null, minutesToPeak: null, minutesToBaseline: null, readingsUsed: win.length };
  }

  const baseline = pre.length ? pre.reduce((a, r) => a + r.v, 0) / pre.length : win[0].v;
  let peak = win[0].v;
  let peakAt = win[0].t;
  for (const r of win) if (r.v > peak) { peak = r.v; peakAt = r.t; }

  const backAt = win.find((r) => r.t > peakAt && r.v <= baseline + BASELINE_TOLERANCE);

  return {
    markerId,
    baseline: Math.round(baseline * 10) / 10,
    peak,
    peakAt,
    delta: Math.round((peak - baseline) * 10) / 10,
    minutesToPeak: peakAt - markerT,
    minutesToBaseline: backAt ? backAt.t - markerT : null,
    readingsUsed: win.length,
  };
}

/** Rebuild Reading objects from the wire format the analyse route returns. */
export function readingsFromWire(series: { t: number[]; v: number[]; flag: Reading['flag'][] }): Reading[] {
  const out: Reading[] = new Array(series.t.length);
  for (let i = 0; i < series.t.length; i++) out[i] = { t: series.t[i], v: series.v[i], flag: series.flag[i] };
  return out;
}
