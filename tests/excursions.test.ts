import { describe, expect, it } from 'vitest';
import { analyse } from '@/server/cgm/analyse';
import { interpret } from '@/server/cgm/interpret';
import { findOnsets, buildEvents, summariseEvents, DETECT_RULES } from '@/server/cgm/excursions';
import { readingsFromWire, mealResponse } from '@/lib/meal-response';
import { classifyMeal } from '@/server/cgm/patterns';
import { makeWorkbook, series, flat } from './helpers';
import type { AnalysisResult, MealMarker, Reading } from './../lib/types';

/**
 * The scan is the part that can embarrass us in front of a coach: report one
 * meal twelve times, miss the obvious one, or call 4am "lunch". Each of those is
 * a test here.
 */

const START = { y: 2026, mo: 7, d: 12, h: 0, mi: 0 };
const build = (values: number[]): AnalysisResult =>
  analyse(makeWorkbook(series(START, values)), 'e.xlsx');
const readingsOf = (r: AnalysisResult): Reading[] => readingsFromWire(r.series);

/** one rise: flat, up +80 fast, back down, flat again — 60 readings = 5h */
const RISE = [108, 130, 155, 172, 180, 178, 165, 148, 132, 118, 108, 102];

describe('finding rises without any marker', () => {
  it('finds a clear rise and puts the onset at the foot, not on the way up', () => {
    const values = [...flat(100, 24), ...RISE, ...flat(100, 40)];
    const rs = readingsOf(build(values));
    const onsets = findOnsets(rs);
    expect(onsets).toHaveLength(1);
    // index 23 is the last flat reading before the climb; the foot is there or
    // at 24, never up at the peak
    const idx = rs.findIndex((r) => r.t === onsets[0]);
    expect(idx).toBeGreaterThanOrEqual(22);
    expect(idx).toBeLessThanOrEqual(25);
  });

  it('reports one rise once, not once per reading on the climb', () => {
    const values = [...flat(100, 24), ...RISE, ...flat(100, 40)];
    expect(findOnsets(readingsOf(build(values)))).toHaveLength(1);
  });

  it('separates two rises that are hours apart', () => {
    const values = [...flat(100, 24), ...RISE, ...flat(100, 36), ...RISE, ...flat(100, 40)];
    const onsets = findOnsets(readingsOf(build(values)));
    expect(onsets).toHaveLength(2);
    expect(onsets[1] - onsets[0]).toBeGreaterThanOrEqual(DETECT_RULES.minSeparation);
  });

  it('puts the onset where the climb starts, not at the lowest wobble an hour earlier', () => {
    // The bug this guards: a long quiet approach with a little noise in it. The
    // deepest wobble sits ~100 minutes before the meal, and anchoring there
    // starts the 3-hour clock early — so the curve is still near its peak at the
    // "3 hour" mark and every ordinary meal gets labelled ค้าง.
    const quiet = [118, 113, 119, 117, 119, 121, 119, 119, 121, 119, 117, 119, 116, 120, 118, 117, 119, 118, 120, 119];
    const climb = [130, 158, 176, 190, 196, 198, 196, 188, 172, 150, 132, 120, 112, 108];
    const values = [...quiet, ...climb, ...flat(110, 40)];
    const rs = readingsOf(build(values));
    const onsets = findOnsets(rs);
    expect(onsets).toHaveLength(1);

    const idx = rs.findIndex((r) => r.t === onsets[0]);
    // the quiet run is indices 0..19; the climb begins at 20. The onset belongs
    // at the end of the quiet run, NOT back at index 1 where 113 sits.
    expect(idx).toBeGreaterThanOrEqual(17);
    expect(idx).toBeLessThanOrEqual(20);

    // and with the clock started correctly this reads as a spike, not as ค้าง
    const p = classifyMeal(onsets[0], mealResponse('x', onsets[0], rs), rs);
    expect(p.primary).toBe('spike');
  });

  it('ignores drift too small to mean anything', () => {
    // ±12 mg/dL wobble, nothing that clears the 30 cut
    const wobble = Array.from({ length: 200 }, (_, i) => 100 + (i % 8) * 3);
    expect(findOnsets(readingsOf(build(wobble)))).toHaveLength(0);
  });

  it('does not crash on a series too short to scan', () => {
    expect(findOnsets([{ t: 0, v: 100, flag: 'ok' }])).toEqual([]);
  });
});

describe('marked meals and found rises together', () => {
  const mk = (id: string, t: number, label: string): MealMarker => ({
    id, t, label, kind: 'lunch', eatingOrder: 'unknown', walkedAfter: false,
    createdAt: 0, updatedAt: 0,
  });

  it('keeps the coach’s label and does not also report the same rise twice', () => {
    const values = [...flat(100, 24), ...RISE, ...flat(100, 40)];
    const rs = readingsOf(build(values));
    const onset = findOnsets(rs)[0];
    // coach marked it 15 minutes off — still the same event
    const events = buildEvents(rs, [mk('m1', onset + 15, 'ข้าวมันไก่')]);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('marked');
    expect(events[0].labelTh).toBe('ข้าวมันไก่');
  });

  it('reports a rise the coach never marked, and says where it came from', () => {
    const values = [...flat(100, 24), ...RISE, ...flat(100, 40)];
    const rs = readingsOf(build(values));
    const events = buildEvents(rs, []);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('detected');
    expect(events[0].labelTh).toBeNull();
    expect(events[0].pattern.primary).toBe('spike');
  });

  it('gives every event a window with lead-in so "back to the start" is visible', () => {
    const rs = readingsOf(build([...flat(100, 24), ...RISE, ...flat(100, 40)]));
    const e = buildEvents(rs, [])[0];
    expect(e.fromT).toBeLessThan(e.t);
    expect(e.toT).toBeGreaterThan(e.t + 180);
  });

  it('drops onsets past the cutoff so the tail is used only for classifying', () => {
    const values = [...flat(100, 24), ...RISE, ...flat(100, 36), ...RISE, ...flat(100, 40)];
    const rs = readingsOf(build(values));
    const [first, second] = findOnsets(rs);
    const events = buildEvents(rs, [], first);
    expect(events.map((e) => e.t)).toEqual([first]);
    expect(second).toBeGreaterThan(first);
  });
});

describe('the snapshot a coach reads first', () => {
  it('counts marked and detected separately so the scan is never mistaken for food', () => {
    const values = [...flat(100, 24), ...RISE, ...flat(100, 36), ...RISE, ...flat(100, 40)];
    const rs = readingsOf(build(values));
    const onsets = findOnsets(rs);
    const events = buildEvents(rs, [{
      id: 'm1', t: onsets[0], label: 'ข้าวมันไก่', kind: 'lunch',
      eatingOrder: 'unknown', walkedAfter: false, createdAt: 0, updatedAt: 0,
    }]);
    const snap = summariseEvents(events, { medsLowering: false });
    expect(snap.marked).toBe(1);
    expect(snap.detected).toBe(1);
  });

  it('counts an overnight rise so nobody calls 3am a meal', () => {
    // rise begins ~02:00, inside the 00:00–06:00 window
    const values = [...flat(100, 24), ...RISE, ...flat(100, 40)];
    const rs = readingsOf(build(values));
    const snap = summariseEvents(buildEvents(rs, []), { medsLowering: false });
    expect(snap.overnightCount).toBe(1);
  });
});

describe('wired into what the coach reads', () => {
  it('scans the window even when no meal was ever marked', () => {
    const values = [...flat(100, 24), ...RISE, ...flat(100, 36), ...RISE, ...flat(100, 36), ...RISE, ...flat(100, 60)];
    const out = interpret(build(values), { meds: 'no' });
    expect(out.events.length).toBeGreaterThanOrEqual(3);
    expect(out.eventSnapshot.detected).toBeGreaterThanOrEqual(3);
    expect(out.eventSnapshot.marked).toBe(0);
    expect(out.eventSnapshot.dominant).toBe('spike');
  });

  it('warns on the sheet that a detected rise is not known to be food', () => {
    const values = [...flat(100, 24), ...RISE, ...flat(100, 36), ...RISE, ...flat(100, 60)];
    const out = interpret(build(values), { meds: 'no' });
    const warned = out.limitationsTh.some((l) => l.includes('ยืนยันไม่ได้ว่ามาจากอาหาร'));
    expect(warned).toBe(true);
  });

  it('never calls a detected rise a meal in any generated sentence', () => {
    // three rises so the headline takes its main branch, where the wording
    // matters most — the short-data branch is asserted above
    const values = [...flat(100, 24), ...RISE, ...flat(100, 36), ...RISE, ...flat(100, 36), ...RISE, ...flat(100, 60)];
    const out = interpret(build(values), { meds: 'no' });
    const detected = out.events.filter((e) => e.source === 'detected');
    expect(detected.length).toBeGreaterThan(0);
    for (const e of detected) expect(e.labelTh).toBeNull();
    // the headline may count in ครั้ง or ช่วง; what it must never do is call an
    // unlabelled rise food
    expect(out.eventSnapshot.headlineTh).toContain('น้ำตาลขึ้น');
    expect(out.eventSnapshot.headlineTh).not.toContain('มื้ออาหาร');
    expect(out.eventSnapshot.headlineTh).not.toContain('ที่กิน');
  });
});
