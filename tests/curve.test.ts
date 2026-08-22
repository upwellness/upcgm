import { describe, expect, it } from 'vitest';
import { linePath, monotonePath, monotoneTangents, seriesPath, type Pt } from '@/lib/curve';

/**
 * The promise of this module is one sentence: the drawn line never leaves the
 * range of the readings that bound it. A smoothing that dips to 61 between a 95
 * and a 68 has drawn a hypo that never happened, on a page someone shows a
 * doctor. So the tests do not check that the path "looks smooth" — they sample
 * the actual curve densely and check every point against the data.
 */

/** Walk a cubic Bézier and return the y values along it. */
function sampleCubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt, steps = 60): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push(u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y);
  }
  return out;
}

/** Pull the control points back out of the path string and sweep every span. */
function sweep(pts: Pt[]): { i: number; y: number }[] {
  const d = monotonePath(pts);
  const cs = d.match(/C[^C]*/g) ?? [];
  expect(cs.length, 'path had no cubic segments to sweep').toBe(pts.length - 1);
  const all: { i: number; y: number }[] = [];
  cs.forEach((seg, i) => {
    const n = (seg.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const [c1x, c1y, c2x, c2y, px, py] = n;
    for (const y of sampleCubic(pts[i], { x: c1x, y: c1y }, { x: c2x, y: c2y }, { x: px, y: py })) {
      all.push({ i, y });
    }
    expect(px).toBeCloseTo(pts[i + 1].x, 1);
    expect(py).toBeCloseTo(pts[i + 1].y, 1);
  });
  return all;
}

const at = (ys: number[]): Pt[] => ys.map((y, i) => ({ x: i * 10, y }));

describe('the smoothed line cannot invent a reading', () => {
  it('stays inside the two readings bounding every span, on a meal spike', () => {
    // the shape this chart is mostly used to read: flat, sharp rise, slow fall
    const pts = at([100, 102, 98, 101, 145, 198, 176, 150, 128, 112, 104, 100]);
    for (const s of sweep(pts)) {
      const lo = Math.min(pts[s.i].y, pts[s.i + 1].y) - 0.05;
      const hi = Math.max(pts[s.i].y, pts[s.i + 1].y) + 0.05;
      expect(s.y, `span ${s.i} (${pts[s.i].y}→${pts[s.i + 1].y}) reached ${s.y}`).toBeGreaterThanOrEqual(lo);
      expect(s.y, `span ${s.i} (${pts[s.i].y}→${pts[s.i + 1].y}) reached ${s.y}`).toBeLessThanOrEqual(hi);
    }
  });

  it('does not dip below the lowest reading around a sharp low', () => {
    // 68 is the floor here; a naive spline undershoots this into level-2 territory
    const pts = at([120, 110, 95, 68, 88, 115, 130]);
    const lowest = Math.min(...pts.map((p) => p.y));
    for (const s of sweep(pts)) {
      expect(s.y, `curve reached ${s.y}, below the lowest reading ${lowest}`).toBeGreaterThanOrEqual(lowest - 0.05);
    }
  });

  it('does not lift a peak above the highest reading', () => {
    const pts = at([90, 96, 130, 205, 132, 98, 92]);
    const highest = Math.max(...pts.map((p) => p.y));
    for (const s of sweep(pts)) {
      expect(s.y, `curve reached ${s.y}, above the highest reading ${highest}`).toBeLessThanOrEqual(highest + 0.05);
    }
  });

  it('flattens the tangent at every turning point', () => {
    // A non-zero tangent on a local peak is exactly how a spline sails past it.
    const ys = [100, 140, 100, 60, 100];
    const m = monotoneTangents(at(ys));
    expect(m[1]).toBe(0); // peak
    expect(m[2]).not.toBe(0); // on the way down, free to slope
    expect(m[3]).toBe(0); // trough
  });

  it('draws a flat run flat, with no ripple between equal readings', () => {
    const pts = at([100, 100, 100, 100, 100]);
    for (const s of sweep(pts)) expect(s.y).toBeCloseTo(100, 6);
  });

  it('passes through every reading exactly', () => {
    // Smoothing may bend the line between points; it may not move the points.
    const pts = at([88, 143, 96, 210, 71]);
    const d = monotonePath(pts);
    for (const p of pts) expect(d).toContain(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  });
});

describe('choosing between the curve and the polyline', () => {
  it('draws straight segments when the readings are closer than a few pixels', () => {
    // 4,000 readings across 900px: the curve and the line are the same picture,
    // and only one of them costs anything to build.
    const many = Array.from({ length: 4000 }, (_, i) => ({ x: i * 0.2, y: 100 + (i % 7) }));
    expect(seriesPath(many, 900)).not.toContain('C');
  });

  it('smooths once the readings are far enough apart to show a corner', () => {
    const few = at([100, 150, 120, 160]);
    expect(seriesPath(few, 900)).toContain('C');
  });

  it('never smooths what it cannot: one or two points', () => {
    expect(monotonePath([])).toBe('');
    expect(monotonePath([{ x: 0, y: 5 }])).toBe('M0.0,5.0');
    expect(monotonePath([{ x: 0, y: 5 }, { x: 10, y: 9 }])).toBe(linePath([{ x: 0, y: 5 }, { x: 10, y: 9 }]));
  });
});
