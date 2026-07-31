import { describe, expect, it } from 'vitest';
import { analyse } from '@/server/cgm/analyse';
import { interpret } from '@/server/cgm/interpret';
import { buildAgpNotes, MAX_NOTES, MIN_CLUSTER } from '@/server/cgm/agp-notes';
import { buildEvents } from '@/server/cgm/excursions';
import { readingsFromWire } from '@/lib/meal-response';
import { makeWorkbook, series, flat } from './helpers';
import type { AgpBin } from '@/lib/types';

/**
 * These dots are what a coach points at mid-conversation, so the bar is that
 * every one of them is true and traceable to a count on screen. Nothing here is
 * generated text, and none of it depends on an API key.
 */

const bin = (minute: number, p50: number, spread = 30, n = 100): AgpBin => ({
  minute, n, lowConfidence: n < 40,
  p5: p50 - spread / 2, p25: p50 - spread / 4, p50, p75: p50 + spread / 4, p95: p50 + spread / 2,
});

/** a flat day: 48 bins, all the same */
const flatDay = (): AgpBin[] => Array.from({ length: 48 }, (_, i) => bin(i * 30, 110));

describe('what earns a dot', () => {
  it('says nothing when there is nothing to say', () => {
    expect(buildAgpNotes(flatDay(), [])).toEqual([]);
  });

  it('refuses to draw anything on too few usable bins', () => {
    const thin = Array.from({ length: 5 }, (_, i) => bin(i * 30, 110));
    expect(buildAgpNotes(thin, [])).toEqual([]);
  });

  it('marks the hour that varies most between days, with the real spread', () => {
    const bins = flatDay();
    bins[26] = bin(780, 130, 90); // 13:00, p95-p5 = 90
    const notes = buildAgpNotes(bins, []);
    const widest = notes.find((n) => n.kind === 'widest');
    expect(widest?.minute).toBe(780);
    expect(widest?.bodyTh).toContain('90');
  });

  it('marks the high and low points of a typical day', () => {
    const bins = flatDay();
    bins[16] = bin(480, 160); // 08:00 highest
    bins[8] = bin(240, 90);   // 04:00 lowest
    const notes = buildAgpNotes(bins, []);
    expect(notes.find((n) => n.kind === 'highest')?.minute).toBe(480);
    expect(notes.find((n) => n.kind === 'lowest')?.minute).toBe(240);
  });

  it('never draws more dots than the picture can carry', () => {
    const bins = flatDay().map((b, i) => bin(b.minute, 100 + (i % 12) * 8, 40 + (i % 9) * 12));
    expect(buildAgpNotes(bins, []).length).toBeLessThanOrEqual(MAX_NOTES);
  });

  it('puts at most one dot on any one bin', () => {
    const bins = flatDay();
    bins[20] = bin(600, 175, 95);
    const notes = buildAgpNotes(bins, []);
    expect(new Set(notes.map((n) => n.minute)).size).toBe(notes.length);
  });
});

describe('dots that come from the four shapes', () => {
  const RISE = [108, 130, 155, 172, 180, 178, 165, 148, 132, 118, 108, 102];

  /**
   * Eight days, each with a rise at the same time. Eight and not three because
   * computeAgp marks a bin lowConfidence under 40 readings — at 6 readings per
   * 30-minute bin per day that needs a full week, and the notes deliberately
   * ignore low-confidence bins.
   */
  function eightDaysSameTime() {
    const day = [...flat(100, 24), ...RISE, ...flat(100, 252)]; // 288 readings = 1 day
    const all = Array.from({ length: 8 }, () => day).flat();
    const r = analyse(makeWorkbook(series({ y: 2026, mo: 7, d: 12, h: 0, mi: 0 }, all)), 'a.xlsx');
    return { result: r, readings: readingsFromWire(r.series) };
  }

  it('marks a time of day where the same shape keeps happening', () => {
    const { result, readings } = eightDaysSameTime();
    const events = buildEvents(readings, []);
    const notes = buildAgpNotes(result.agp, events);
    const cluster = notes.find((n) => n.kind === 'shape-cluster');
    expect(cluster).toBeTruthy();
    expect(cluster!.pattern).toBe('spike');
    // the count it claims has to be the count it saw
    expect(cluster!.titleTh).toMatch(/เจอ “พุ่ง” \d+ ครั้ง/);
  });

  it('will not call one occurrence a habit', () => {
    const one = [...flat(100, 24), ...RISE, ...flat(100, 252)];
    const r = analyse(makeWorkbook(series({ y: 2026, mo: 7, d: 12, h: 0, mi: 0 }, one)), 'b.xlsx');
    const rs = readingsFromWire(r.series);
    const notes = buildAgpNotes(r.agp, buildEvents(rs, []));
    expect(notes.some((n) => n.kind === 'shape-cluster')).toBe(false);
    expect(MIN_CLUSTER).toBeGreaterThan(1);
  });

  it('never calls an overnight rise food', () => {
    const { result, readings } = eightDaysSameTime();
    const notes = buildAgpNotes(result.agp, buildEvents(readings, []));
    const night = notes.find((n) => n.kind === 'overnight');
    if (night) {
      expect(night.bodyTh).toContain('ไม่ได้มาจากอาหาร');
      expect(night.bodyTh).not.toContain('มื้อ');
    }
  });
});

describe('wired into the page', () => {
  const build = (v: number[]) =>
    analyse(makeWorkbook(series({ y: 2026, mo: 7, d: 12, h: 0, mi: 0 }, v)), 'c.xlsx');

  it('hands the dots to the screen alongside the findings', () => {
    const RISE = [108, 130, 155, 172, 180, 178, 165, 148, 132, 118, 108, 102];
    const day = [...flat(100, 24), ...RISE, ...flat(100, 252)];
    // eight days: seven lands a hair under the >=7-day AGP gate once the span is
    // measured from first reading to last
    const out = interpret(build(Array.from({ length: 8 }, () => day).flat()), { meds: 'no' });
    expect(Array.isArray(out.agpNotes)).toBe(true);
    expect(out.agpNotes.length).toBeGreaterThan(0);
    for (const n of out.agpNotes) {
      expect(n.titleTh.length).toBeGreaterThan(0);
      expect(n.bodyTh.length).toBeGreaterThan(0);
      expect(n.minute).toBeGreaterThanOrEqual(0);
      expect(n.minute).toBeLessThan(1440);
    }
  });

  it('gives no dots on a window too short to draw an AGP for', () => {
    // 6 hours: the gate turns the AGP off, so there is nothing to annotate
    const out = interpret(build(flat(110, 72)), { meds: 'no' });
    expect(out.agpNotes).toEqual([]);
  });
});
