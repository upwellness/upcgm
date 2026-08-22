import { describe, expect, it } from 'vitest';
import { MIN_SPAN_MINUTES, clampView, pinchView } from '@/lib/zoom';

/** A fourteen-day window, the shape of a real wear. */
const W = { from: 0, to: 14 * 1440 };
const total = W.to - W.from;

describe('fitting a zoom inside the window', () => {
  it('never shows time the file does not cover', () => {
    // dragged far past the right-hand edge
    const v = clampView(W, W.to + 5000, 240)!;
    expect(v.to).toBeLessThanOrEqual(W.to);
    expect(v.from).toBeGreaterThanOrEqual(W.from);
    expect(v.to - v.from).toBe(240);

    // and past the left
    const u = clampView(W, W.from - 5000, 240)!;
    expect(u.from).toBe(W.from);
    expect(u.to - u.from).toBe(240);
  });

  it('keeps the span when a pan hits an edge, rather than squashing it', () => {
    // Shrinking the view at the edge would make panning feel like it zooms.
    const v = clampView(W, W.to - 10, 600)!;
    expect(v.to - v.from).toBe(600);
    expect(v.to).toBe(W.to);
  });

  it('stops zooming in at half an hour', () => {
    for (const asked of [20, 5, 0.5, 0]) {
      const v = clampView(W, 5000, asked)!;
      expect(v.to - v.from, `asked for ${asked} minutes`).toBe(MIN_SPAN_MINUTES);
    }
  });

  it('reports the whole window as no zoom at all', () => {
    // so the caller can hide the reset button instead of offering a no-op
    expect(clampView(W, W.from, total)).toBeNull();
    expect(clampView(W, W.from, total * 3)).toBeNull();
  });

  it('survives a window shorter than the zoom floor', () => {
    // a 20-minute custom range: there is nothing to zoom into, and it must not
    // return a view wider than the data
    const tiny = { from: 100, to: 120 };
    expect(clampView(tiny, 100, 5)).toBeNull();
  });
});

describe('pinching holds the reading under the fingers', () => {
  it('keeps the anchored moment at the same place across the plot', () => {
    const anchorT = 6000;
    for (const scale of [1.5, 2, 4, 0.5, 0.75]) {
      for (const frac of [0.2, 0.5, 0.8]) {
        const v = pinchView(W, 2000, anchorT, scale, frac)!;
        const where = (anchorT - v.from) / (v.to - v.from);
        expect(where, `scale ${scale} at ${frac}`).toBeCloseTo(frac, 6);
      }
    }
  });

  it('zooms in when the fingers spread and out when they close', () => {
    const wider = pinchView(W, 2000, 6000, 0.5, 0.5)!;
    const tighter = pinchView(W, 2000, 6000, 2, 0.5)!;
    expect(tighter.to - tighter.from).toBe(1000);
    expect(wider.to - wider.from).toBe(4000);
  });

  it('pans when two fingers move together without spreading', () => {
    // same scale, midpoint slid from the centre to the left third
    const before = pinchView(W, 2400, 6000, 1, 0.5)!;
    const after = pinchView(W, 2400, 6000, 1, 0.25)!;
    expect(after.to - after.from).toBe(before.to - before.from);
    expect(after.from).toBeGreaterThan(before.from);
  });

  it('does not divide by a zero scale when both fingers land together', () => {
    const v = pinchView(W, 2000, 6000, 0, 0.5);
    expect(v).toBeNull(); // clamped out to the whole window, not NaN or Infinity
  });

  it('clamps an anchored pinch at the edges without losing the anchor entirely', () => {
    // anchored near the very start, zooming out: the view sticks to the edge
    const v = pinchView(W, 600, 30, 0.5, 0.5)!;
    expect(v.from).toBe(W.from);
    expect(v.to - v.from).toBe(1200);
  });
});
