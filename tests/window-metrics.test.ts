import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/ai/route';
import { analyse } from '@/server/cgm/analyse';
import { makeWorkbook, series } from './helpers';

/**
 * A hand-picked range — typed into the picker, or zoomed on the chart and sent
 * with "recompute for this range" — has no figures of its own, because the maths
 * that produces them is not shipped to the browser.
 *
 * What used to fill that hole was the whole file's metrics. That reads like a
 * harmless default and is not one: interpret() clips its event scan to the span
 * of whatever metrics it is handed, so every finding under a heading naming one
 * evening described the entire fortnight. These tests pin the window down.
 */

const DAY = 288;

/** Sixteen days: quiet, except one afternoon with a large spike. */
function wear() {
  const values: number[] = [];
  for (let d = 0; d < 16; d++) {
    for (let i = 0; i < DAY; i++) {
      const min = i * 5;
      // one sharp rise a day at 12:00, and on day 8 an extra tall one at 18:00
      let v = 100;
      if (min >= 720 && min < 900) v += 80 * Math.exp(-(((min - 765) ** 2) / 1600));
      if (d === 8 && min >= 1080 && min < 1260) v += 150 * Math.exp(-(((min - 1125) ** 2) / 1600));
      values.push(Math.round(v));
    }
  }
  return analyse(makeWorkbook(series({ y: 2026, mo: 7, d: 1, h: 0, mi: 0 }, values)), 'a.xlsx', 'en');
}

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/ai', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));

describe('a hand-picked window is judged on its own readings', () => {
  it('counts only the rises inside the range, not the whole file', async () => {
    const result = wear();
    const from = result.metrics.firstT + 8 * 1440;          // start of day 9
    const to = from + 1440;                                  // one day

    const whole = await (await post({ result, meds: 'no', locale: 'en' })).json();
    const oneDay = await (await post({
      result: { ...result, metrics: null, quality: { ...result.quality, spanDays: 1, capturePct: 100 } },
      windowFrom: from, windowTo: to, meds: 'no', locale: 'en',
    })).json();

    expect(whole.interpretation.eventSnapshot.judged).toBeGreaterThan(12);
    // one ordinary lunch rise plus the tall evening one — not sixteen days' worth
    expect(oneDay.interpretation.eventSnapshot.judged).toBeLessThanOrEqual(3);
    expect(oneDay.interpretation.eventSnapshot.judged).toBeGreaterThan(0);
  });

  it('hands the window its own figures back for the cards to print', async () => {
    const result = wear();
    const from = result.metrics.firstT + 8 * 1440;
    const j = await (await post({
      result: { ...result, metrics: null, quality: { ...result.quality, spanDays: 1, capturePct: 100 } },
      windowFrom: from, windowTo: from + 1440, meds: 'no', locale: 'en',
    })).json();

    expect(j.windowMetrics).toBeTruthy();
    // day 9 carries the tall spike, so its average sits above the quiet days'
    expect(j.windowMetrics.mean).toBeGreaterThan(result.metrics.mean);
    expect(j.windowMetrics.n).toBeGreaterThan(200);
    expect(j.windowMetrics.n).toBeLessThan(DAY + 10);
    // and the gate that decides what may be shown comes from the server too
    expect(j.windowGate).toBeTruthy();
    expect(typeof j.windowGate.showRangePercents).toBe('boolean');
  });

  it('says so plainly when the range holds nothing usable', async () => {
    const result = wear();
    const res = await post({
      result: { ...result, metrics: null, quality: { ...result.quality, spanDays: 0.01, capturePct: 0 } },
      windowFrom: result.metrics.lastT + 5000, windowTo: result.metrics.lastT + 6000,
      meds: 'no', locale: 'en',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).reasonTh).toContain('No usable readings');
  });

  it('still refuses a request that names no window and carries no figures', async () => {
    const result = wear();
    const res = await post({ result: { ...result, metrics: null }, meds: 'no', locale: 'en' });
    expect(res.status).toBe(400);
  });
});
