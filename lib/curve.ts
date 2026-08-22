/**
 * Monotone cubic interpolation — the only smoothing this chart is allowed.
 *
 * A plain spline through glucose readings overshoots. Between a reading of 95
 * and one of 68 a Catmull-Rom curve will happily dip to 61 on its way, drawing
 * a low that never happened, and it lifts peaks above the highest number the
 * sensor ever reported. On a page someone carries to a doctor that is not a
 * cosmetic flaw — it is a reading the body never produced.
 *
 * The Fritsch–Carlson limiter (SIAM J. Numer. Anal. 17(2), 1980) removes the
 * possibility. It clamps each tangent so the interpolant is monotone wherever
 * the data is, which means the curve on any interval stays between the two
 * readings that bound it. It can round a corner; it cannot invent a value.
 * tests/curve.test.ts asserts that against a dense sweep of the output.
 */

export interface Pt {
  x: number;
  y: number;
}

const f1 = (n: number) => n.toFixed(1);

/** Straight segments — what the chart drew before, kept for dense stretches. */
export function linePath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f1(p.x)},${f1(p.y)}`).join(' ');
}

/**
 * Tangents at each point, already limited so no interval can overshoot.
 * Exported for the test, which checks the limiter on its own terms.
 */
export function monotoneTangents(pts: Pt[]): number[] {
  const n = pts.length;
  if (n < 2) return new Array(n).fill(0);

  // secant slope of each interval
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1].x - pts[i].x;
    d.push(h === 0 ? 0 : (pts[i + 1].y - pts[i].y) / h);
  }

  // start with the average of the two neighbouring secants
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // A sign change is a local peak or trough. Its tangent must be flat, or the
    // curve sails past the turning point — which is precisely the invented
    // spike this whole module exists to prevent.
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }

  // Fritsch–Carlson: keep (α, β) inside the circle of radius 3
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }
  return m;
}

/** An SVG path through the points, smoothed but never overshooting them. */
export function monotonePath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n < 3) return linePath(pts);

  const m = monotoneTangents(pts);
  let out = `M${f1(pts[0].x)},${f1(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (pts[i + 1].x - pts[i].x) / 3;
    const c1x = pts[i].x + h;
    const c1y = pts[i].y + m[i] * h;
    const c2x = pts[i + 1].x - h;
    const c2y = pts[i + 1].y - m[i + 1] * h;
    out += ` C${f1(c1x)},${f1(c1y)} ${f1(c2x)},${f1(c2y)} ${f1(pts[i + 1].x)},${f1(pts[i + 1].y)}`;
  }
  return out;
}

/**
 * Below this many pixels between readings the curve and the polyline are the
 * same picture, so a fourteen-day view draws straight segments and skips the
 * work. The smoothing is for the zoomed-in view, which is where the corners are
 * actually wide enough to see.
 */
export const SMOOTH_MIN_STEP_PX = 2.5;

/** Whichever of the two suits the density on screen. */
export function seriesPath(pts: Pt[], plotWidthPx: number): string {
  if (pts.length < 3) return linePath(pts);
  const stepPx = plotWidthPx / Math.max(1, pts.length - 1);
  return stepPx < SMOOTH_MIN_STEP_PX ? linePath(pts) : monotonePath(pts);
}
