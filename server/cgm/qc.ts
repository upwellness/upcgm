import type { Gap, QcNote, Reading } from '@/lib/types';
import { DEVICE_FLOOR, MAX_ROC_PER_5MIN } from './thresholds';

/**
 * The Ottai sensor cannot report below 36 mg/dL, so 36 means "36 or lower, we
 * can't tell". Two very different things arrive wearing that number:
 *
 *  - a genuine low the device clipped (values around it are also low) → keep it,
 *    counted as 36. Discarding these would let the app announce "no lows" to
 *    someone who had them, which is the worse mistake.
 *  - the signal dropping out, usually from lying on the sensor → exclude from
 *    the maths, keep on the chart. Real files hold a run of 110 of these in a
 *    row: 9.2 hours that would otherwise be reported as severe hypoglycaemia.
 *
 * Telling them apart is a judgement, so the run is *flagged* rather than
 * silently deleted, and the coach can flip the toggle and see both numbers.
 */
export function classifyFloorRuns(readings: Reading[]): QcNote[] {
  const notes: QcNote[] = [];
  let i = 0;
  while (i < readings.length) {
    if (readings[i].v > DEVICE_FLOOR) { i++; continue; }

    let j = i;
    while (j < readings.length && readings[j].v <= DEVICE_FLOOR) j++;

    const before = i > 0 ? readings[i - 1].v : null;
    const after = j < readings.length ? readings[j].v : null;
    const count = j - i;
    const minutes = (readings[j - 1].t - readings[i].t) + 5;

    const entryDrop = before == null ? Infinity : before - DEVICE_FLOOR;
    const artifact =
      // Arriving from a normal value in one step is not physiology.
      entryDrop > MAX_ROC_PER_5MIN ||
      // Ends at the tail of the file: sensor removed or dead, not a recovery.
      after == null ||
      // Pinned exactly at the floor for over two hours: lost signal.
      count > 24;

    const flag = artifact ? 'artifact' : 'censored';
    for (let k = i; k < j; k++) readings[k].flag = flag;

    notes.push({
      kind: artifact ? 'floor-artifact' : 'floor-censored',
      from: readings[i].t, to: readings[j - 1].t,
      count, minutes, before, after,
    });
    i = j;
  }
  return notes;
}

/**
 * A single reading that both arrives and leaves faster than glucose can move,
 * in opposite directions. Flagged, never deleted — the reader decides.
 */
export function flagSpikes(readings: Reading[]): QcNote[] {
  const notes: QcNote[] = [];
  for (let i = 1; i < readings.length - 1; i++) {
    const cur = readings[i];
    if (cur.flag !== 'ok') continue;
    const prev = readings[i - 1], next = readings[i + 1];
    if (cur.t - prev.t > 10 || next.t - cur.t > 10) continue;

    const up = cur.v - prev.v;
    const down = next.v - cur.v;
    if (Math.abs(up) > MAX_ROC_PER_5MIN && Math.abs(down) > MAX_ROC_PER_5MIN && Math.sign(up) !== Math.sign(down)) {
      cur.flag = 'suspect';
      notes.push({
        kind: 'spike', from: cur.t, to: cur.t, count: 1, minutes: 5,
        before: prev.v, after: next.v,
      });
    }
  }
  return notes;
}

/**
 * Missing stretches. The chart must break the line here — joining across a
 * six-hour dropout draws a flat, calm period that never happened.
 */
export function findGaps(readings: Reading[], stepMinutes = 5): Gap[] {
  const tolerance = stepMinutes * 3;
  const gaps: Gap[] = [];
  for (let i = 1; i < readings.length; i++) {
    const delta = readings[i].t - readings[i - 1].t;
    if (delta > tolerance) {
      gaps.push({ from: readings[i - 1].t, to: readings[i].t, minutes: delta });
    }
  }
  return gaps;
}

/** Most common spacing between readings — 5 minutes for every file seen so far. */
export function detectInterval(readings: Reading[]): number {
  if (readings.length < 2) return 5;
  const counts = new Map<number, number>();
  for (let i = 1; i < readings.length; i++) {
    const d = Math.round(readings[i].t - readings[i - 1].t);
    if (d > 0 && d <= 60) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = 5, bestCount = 0;
  for (const [d, c] of counts) if (c > bestCount) { best = d; bestCount = c; }
  return best;
}

/** Only these feed the numbers. `artifact` and `suspect` are shown, not counted. */
export const isMetricGrade = (r: Reading): boolean => r.flag === 'ok' || r.flag === 'censored';
