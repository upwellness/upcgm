import { describe, expect, it } from 'vitest';
import { classify, computeAgp, computeMealResponse, computeMetrics, findLowEvents, quantile } from '@/server/cgm/metrics';
import { gateForWindow } from '@/server/cgm/thresholds';
import type { Reading } from '@/lib/types';

const at = (dayOffset: number, hour: number, minute: number) =>
  Date.UTC(2026, 6, 8 + dayOffset, hour, minute) / 60000;

const mk = (values: number[], startHour = 0): Reading[] =>
  values.map((v, i) => ({ t: at(0, startHour, 0) + i * 5, v, flag: 'ok' as const }));

describe('band classification', () => {
  it('puts boundary values in the band the consensus intends', () => {
    // The real file has readings sitting exactly on each edge, so getting this
    // wrong shifts TITR by more than a point with nothing visible on screen.
    expect(classify(53.9)).toBe('tbr54');
    expect(classify(54)).toBe('tbr70');
    expect(classify(69.9)).toBe('tbr70');
    expect(classify(70)).toBe('tir');
    expect(classify(140)).toBe('tir');
    expect(classify(180)).toBe('tir');
    expect(classify(180.1)).toBe('tar180');
    expect(classify(250)).toBe('tar180');
    expect(classify(250.1)).toBe('tar250');
  });

  it('splits a set sitting on every boundary exactly', () => {
    const m = computeMetrics(mk([54, 70, 140, 180, 250]))!;
    expect(m.tbrUnder54).toBeCloseTo(0, 6);
    expect(m.tbrUnder70).toBeCloseTo(20, 6);
    expect(m.tir70_180).toBeCloseTo(60, 6);
    expect(m.titr70_140).toBeCloseTo(40, 6);
    expect(m.tarOver180).toBeCloseTo(20, 6);
    expect(m.tarOver250).toBeCloseTo(0, 6);
  });

  it('keeps the three headline percentages at exactly 100', () => {
    const m = computeMetrics(mk([40, 60, 90, 120, 200, 300, 75, 85]))!;
    expect(m.tbrUnder70 + m.tir70_180 + m.tarOver180).toBeCloseTo(100, 10);
  });
});

describe('standard deviation convention', () => {
  it('uses the sample formula (n−1), which the AGP report expects', () => {
    // [100,110,120]: n−1 gives SD 10 and CV 9.09%; n gives 8.165 and 7.42%.
    // The real 3,083-reading file rounds to 19.9 either way, so only a small
    // set can pin this down — and CV 36% is a clinical line, so it must be
    // pinned down.
    const m = computeMetrics(mk([100, 110, 120]))!;
    expect(m.mean).toBeCloseTo(110, 10);
    expect(m.sd).toBeCloseTo(10, 6);
    expect(m.cv).toBeCloseTo(9.0909, 3);
  });

  it('returns 0 rather than NaN when every reading is identical', () => {
    const m = computeMetrics(mk([100, 100, 100, 100]))!;
    expect(m.sd).toBe(0);
    expect(m.cv).toBe(0);
    expect(Number.isNaN(m.cv)).toBe(false);
  });

  it('survives a single reading', () => {
    const m = computeMetrics(mk([120]))!;
    expect(m.n).toBe(1);
    expect(m.mean).toBe(120);
    expect(m.sd).toBe(0);
    expect(m.gmi).toBeNull(); // one point cannot support a 3-month estimate
  });
});

describe('GMI', () => {
  it('matches the published formula once the span is long enough', () => {
    const values = Array.from({ length: 288 * 4 }, (_, i) => (i % 2 === 0 ? 110 : 120));
    const rs: Reading[] = values.map((v, i) => ({ t: at(0, 0, 0) + i * 5, v, flag: 'ok' }));
    const m = computeMetrics(rs)!;
    expect(m.mean).toBeCloseTo(115, 6);
    expect(m.gmi!).toBeCloseTo(3.31 + 0.02392 * 115, 6);
    expect(m.gmi!).toBeCloseTo(6.0608, 3);
  });

  it('withholds GMI on a short window instead of printing a convincing number', () => {
    const m = computeMetrics(mk([100, 110, 120, 130]))!;
    expect(m.gmi).toBeNull();
  });
});

describe('metric gate by window length', () => {
  it('hides the range percentages and GMI on a three-hour slice', () => {
    const g = gateForWindow(0.125, 100);
    expect(g.showRangePercents).toBe(false);
    expect(g.showGmi).toBe(false);
    expect(g.noteTh).toBeTruthy();
  });

  it('allows CV but still withholds GMI below three days', () => {
    expect(gateForWindow(2, 100).showGmi).toBe(false);
    expect(gateForWindow(2, 100).showCv).toBe(false);
  });

  it('flags a span under fourteen days without hiding the numbers', () => {
    const g = gateForWindow(10.7, 100);
    expect(g.showRangePercents).toBe(true);
    expect(g.showGmi).toBe(true);
    expect(g.noteTh).toContain('14');
  });

  it('withholds GMI when capture is below seventy percent', () => {
    expect(gateForWindow(14, 63.9).showGmi).toBe(false);
  });

  it('shows everything on a complete fourteen-day wear', () => {
    expect(gateForWindow(14, 100).noteTh).toBeNull();
  });
});

describe('quantile', () => {
  it('interpolates the way numpy and R type 7 do', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 10);
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10);
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([7], 0.9)).toBe(7);
  });
});

describe('AGP binning', () => {
  it('lands a midnight reading in the first bin and noon in the middle', () => {
    const rs: Reading[] = [
      { t: at(0, 0, 5), v: 100, flag: 'ok' },
      { t: at(0, 12, 5), v: 200, flag: 'ok' },
    ];
    const bins = computeAgp(rs);
    expect(bins).toHaveLength(48);
    expect(bins[0].n).toBe(1);
    expect(bins[0].p50).toBe(100);
    expect(bins[24].p50).toBe(200);
  });

  it('marks bins with too few readings so the outer lines are not trusted', () => {
    const bins = computeAgp([{ t: at(0, 3, 0), v: 90, flag: 'ok' }]);
    expect(bins[6].lowConfidence).toBe(true);
  });
});

describe('low events', () => {
  it('groups a run into one event and records the nadir', () => {
    const rs = mk([100, 68, 60, 52, 66, 100, 100]);
    const events = findLowEvents(rs);
    expect(events).toHaveLength(1);
    expect(events[0].count).toBe(4);
    expect(events[0].nadir).toBe(52);
    expect(events[0].level).toBe('level2');
  });

  it('marks a vertical drop as possible sensor compression, not a verdict', () => {
    // 106 → 36 in five minutes is not something a pancreas does.
    const rs = mk([106, 36, 36, 104]);
    const events = findLowEvents(rs);
    expect(events[0].suspectedCompression).toBe(true);
  });

  it('leaves a gradual low alone', () => {
    const rs = mk([95, 84, 74, 66, 61, 64, 72, 88]);
    const events = findLowEvents(rs);
    expect(events).toHaveLength(1);
    expect(events[0].suspectedCompression).toBe(false);
  });

  it('tags an overnight event', () => {
    const rs: Reading[] = [
      { t: at(0, 2, 55), v: 90, flag: 'ok' },
      { t: at(0, 3, 0), v: 64, flag: 'ok' },
      { t: at(0, 3, 5), v: 88, flag: 'ok' },
    ];
    expect(findLowEvents(rs)[0].overnight).toBe(true);
  });
});

describe('meal response', () => {
  it('reports the return-to-baseline time, not just the peak', () => {
    const markerT = at(0, 12, 0);
    const rs: Reading[] = [
      { t: markerT - 10, v: 100, flag: 'ok' },
      { t: markerT - 5, v: 102, flag: 'ok' },
      { t: markerT, v: 101, flag: 'ok' },
      { t: markerT + 30, v: 150, flag: 'ok' },
      { t: markerT + 45, v: 174, flag: 'ok' },
      { t: markerT + 90, v: 130, flag: 'ok' },
      { t: markerT + 120, v: 108, flag: 'ok' },
    ];
    const r = computeMealResponse(markerT, rs);
    expect(r.baseline).toBeCloseTo(101, 1);
    expect(r.peak).toBe(174);
    expect(r.minutesToPeak).toBe(45);
    expect(r.minutesToBaseline).toBe(120);
    expect(r.delta).toBeCloseTo(73, 1);
  });

  it('refuses to guess when the window is nearly empty', () => {
    const markerT = at(0, 12, 0);
    const r = computeMealResponse(markerT, [{ t: markerT, v: 100, flag: 'ok' }]);
    expect(r.peak).toBeNull();
    expect(r.minutesToBaseline).toBeNull();
  });
});

describe('excluded readings', () => {
  it('keeps artifacts out of the numbers but counts censored lows', () => {
    const rs: Reading[] = [
      { t: at(0, 0, 0), v: 100, flag: 'ok' },
      { t: at(0, 0, 5), v: 36, flag: 'artifact' },
      { t: at(0, 0, 10), v: 36, flag: 'censored' },
      { t: at(0, 0, 15), v: 100, flag: 'ok' },
    ];
    const m = computeMetrics(rs)!;
    expect(m.n).toBe(3); // the artifact is out
    expect(m.tbrUnder54).toBeCloseTo(100 / 3, 6); // the censored low is in
  });
});
