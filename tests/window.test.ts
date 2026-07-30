import { describe, expect, it } from 'vitest';
import { PRESETS, presetWindows, sliceReadings, summarise } from '@/server/cgm/window';
import type { Reading } from '@/lib/types';

/** 20 days of 5-minute readings, ending 2026-07-30 00:00. */
function build(days: number, valueAt: (i: number) => number = () => 110): Reading[] {
  const end = Date.UTC(2026, 6, 30, 0, 0) / 60000;
  const n = days * 288;
  const out: Reading[] = [];
  for (let i = 0; i < n; i++) out.push({ t: end - (n - 1 - i) * 5, v: valueAt(i), flag: 'ok' });
  return out;
}

describe('slicing', () => {
  it('includes readings sitting exactly on both boundaries', () => {
    const rs = build(1);
    const from = rs[10].t;
    const to = rs[20].t;
    const slice = sliceReadings(rs, from, to);
    expect(slice[0].t).toBe(from);
    expect(slice[slice.length - 1].t).toBe(to);
    expect(slice).toHaveLength(11);
  });
});

describe('preset windows', () => {
  it('anchors to the last reading, not to the current time', () => {
    // A coach opening Monday's download on Thursday must still see wear data in
    // the "last 24 hours" view, not an empty chart.
    const rs = build(20);
    const last = rs[rs.length - 1].t;
    const w24 = presetWindows(rs).find((w) => w.key === '24h')!;
    expect(w24.to).toBe(last);
    expect(w24.from).toBe(last - 1440);
    expect(w24.n).toBeGreaterThan(280);
  });

  it('marks a preset longer than the file as truncated', () => {
    const rs = build(6);
    const windows = presetWindows(rs);
    const w30 = windows.find((w) => w.key === '30d');
    const w3 = windows.find((w) => w.key === '3d')!;
    expect(w30?.truncated ?? true).toBe(true);
    expect(w3.truncated).toBe(false);
  });

  it('offers each whole-file span only once', () => {
    // 30d, 14d and 7d over a 6-day file would draw three identical charts, which
    // makes a coach doubt the tool rather than the data.
    const windows = presetWindows(build(6));
    const wholeFile = windows.filter((w) => w.truncated);
    expect(wholeFile).toHaveLength(1);
    expect(windows.map((w) => w.key)).toContain('3d');
  });

  it('gates metrics per window, so a 3-hour slice cannot show a GMI', () => {
    const windows = presetWindows(build(20));
    const w3h = windows.find((w) => w.key === '3h')!;
    const w14d = windows.find((w) => w.key === '14d')!;
    expect(w3h.gate.showGmi).toBe(false);
    expect(w3h.gate.showRangePercents).toBe(false);
    expect(w14d.gate.showGmi).toBe(true);
    expect(w14d.gate.noteTh).toBeNull();
  });

  it('withholds the AGP below a week — two points cannot make a percentile band', () => {
    const windows = presetWindows(build(20));
    expect(windows.find((w) => w.key === '3d')!.agp).toHaveLength(0);
    expect(windows.find((w) => w.key === '14d')!.agp.length).toBeGreaterThan(0);
  });

  it('returns nothing for an empty set rather than throwing', () => {
    expect(presetWindows([])).toEqual([]);
  });

  it('covers every declared preset on a long enough file', () => {
    const keys = presetWindows(build(40)).map((w) => w.key);
    for (const p of PRESETS) expect(keys).toContain(p.key);
  });
});

describe('window capture', () => {
  it('reports capture as a share of what a full window would hold', () => {
    const rs = build(1);
    const half = rs.filter((_, i) => i % 2 === 0);
    const w = summarise(half, half[0].t, half[half.length - 1].t, 'x', 'x');
    // Half the readings over the same span, at a detected 10-minute interval,
    // is complete for that cadence — not 50%.
    expect(w.capturePct).toBeGreaterThan(95);
  });

  it('never claims more than 100% capture', () => {
    const rs = build(1);
    const w = summarise(rs, rs[0].t, rs[rs.length - 1].t, 'x', 'x', { intervalMinutes: 15 });
    expect(w.capturePct).toBeLessThanOrEqual(100);
  });

  it('survives a window that contains nothing', () => {
    const rs = build(1);
    const w = summarise(rs, rs[rs.length - 1].t + 10_000, rs[rs.length - 1].t + 20_000, 'x', 'x');
    expect(w.n).toBe(0);
    expect(w.metrics).toBeNull();
    expect(w.capturePct).toBe(0);
  });

  it('excludes artifacts from capture but keeps them in the reading count', () => {
    const rs = build(1);
    for (let i = 0; i < 100; i++) rs[i].flag = 'artifact';
    const w = summarise(rs, rs[0].t, rs[rs.length - 1].t, 'x', 'x', { intervalMinutes: 5 });
    expect(w.n).toBe(rs.length);
    expect(w.capturePct).toBeLessThan(100);
  });
});
