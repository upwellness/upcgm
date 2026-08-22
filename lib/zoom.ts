/**
 * The arithmetic behind pinching and dragging the glucose chart.
 *
 * It lives outside the component because getting it wrong is quiet: a pan that
 * drifts past the end of the file shows empty axis, and a pinch whose anchor
 * slips moves the reading out from under the finger holding it. Neither throws,
 * neither shows up in a screenshot, and both make the chart feel broken in a way
 * nobody can describe. Here it can be checked directly — see tests/zoom.test.ts.
 */

/**
 * Closest the reader can zoom. At one reading per five minutes half an hour is
 * seven points across the full width; past that the chart magnifies the gaps
 * between readings and starts to look like data it does not have.
 */
export const MIN_SPAN_MINUTES = 30;

/** Both ends in minutes since the epoch, the unit the whole app counts in. */
export interface Span {
  from: number;
  to: number;
}

/**
 * Fit a proposed view inside the analysed window.
 *
 * Returns `null` for "no zoom" — the whole window — rather than a span equal to
 * it, so the caller has one unambiguous state for zoomed-out and can drop the
 * reset button instead of leaving it saying "back to where you already are".
 */
export function clampView(bounds: Span, nextFrom: number, nextSpan: number): Span | null {
  const total = Math.max(1, bounds.to - bounds.from);
  const span = Math.min(Math.max(nextSpan, MIN_SPAN_MINUTES), total);
  if (span >= total) return null;
  const from = Math.max(bounds.from, Math.min(nextFrom, bounds.to - span));
  return { from, to: from + span };
}

/**
 * Where the view lands mid-pinch.
 *
 * `anchorT` is the moment that sat under the midpoint of the two fingers when
 * the gesture began, and `frac` is where that midpoint is now across the plot.
 * Solving for the same moment at the same fraction is what makes the chart move
 * with the fingers rather than under them — and it handles a two-finger pan for
 * free, since fingers that move together without spreading change `frac` alone.
 */
export function pinchView(
  bounds: Span,
  startSpan: number,
  anchorT: number,
  scale: number,
  frac: number,
): Span | null {
  const nextSpan = startSpan / Math.max(0.001, scale);
  return clampView(bounds, anchorT - frac * nextSpan, nextSpan);
}
