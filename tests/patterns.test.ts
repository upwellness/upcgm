import { describe, expect, it } from 'vitest';
import { analyse } from '@/server/cgm/analyse';
import { interpret } from '@/server/cgm/interpret';
import { classifyMeal, summarisePatterns, analysePatterns, PATTERN_RULES } from '@/server/cgm/patterns';
import { mealResponse, readingsFromWire } from '@/lib/meal-response';
import { makeWorkbook, series, flat } from './helpers';
import type { AnalysisResult, MealMarker, Reading } from '@/lib/types';

/**
 * The four shapes are a teaching device we invented, which makes them easier to
 * get subtly wrong than a published metric — nobody else's test suite will catch
 * a drifting threshold. So each shape is asserted against a curve built to be
 * unambiguously that shape, plus the refusals: too little data, and the
 * in-between curve that is not any of the four.
 */

const START = { y: 2026, mo: 7, d: 12, h: 0, mi: 0 };

function build(values: number[]): AnalysisResult {
  return analyse(makeWorkbook(series(START, values)), 'p.xlsx');
}
function readingsOf(r: AnalysisResult): Reading[] {
  return readingsFromWire(r.series);
}
/** marker time = index into the 5-minute series */
function markerAt(idx: number, rs: Reading[]): number {
  return rs[idx].t;
}
function classifyAt(values: number[], idx: number) {
  const r = build(values);
  const rs = readingsOf(r);
  const t = markerAt(idx, rs);
  return classifyMeal(t, mealResponse('m1', t, rs), rs);
}

/** 60 readings = 5 hours at one per 5 minutes. Meal lands at index 24 (2h in). */
const LEAD = flat(100, 24);

describe('shape of one meal', () => {
  it('calls a fast tall rise พุ่ง', () => {
    // +80 in 30 min, back down by 90 min — the textbook spike
    const values = [...LEAD, 108, 130, 155, 172, 180, 178, 165, 148, 132, 118, 108, 102, ...flat(100, 40)];
    const p = classifyAt(values, 24);
    expect(p.primary).toBe('spike');
    expect(p.metrics.delta).toBeGreaterThanOrEqual(PATTERN_RULES.spikeDelta);
    expect(p.metrics.minutesToPeak).toBeLessThanOrEqual(PATTERN_RULES.spikeMinutesToPeak);
  });

  it('calls a low but long plateau กว้าง', () => {
    // peaks only +49 (under the spike cut) but holds >30 above baseline for
    // ~2h40m, then comes down in time so it is not ค้าง either
    const values = [...LEAD,
      112, 132, 144, 150, 152,
      148, 148, 147, 147, 146, 146, 145, 145, 145, 144, 144, 144, 143, 143, 143,
      142, 142, 142, 141, 141, 141, 140, 140, 140, 140, 140,
      138, 136, 134, 120, 106, 100,
      ...flat(100, 24)];
    const p = classifyAt(values, 24);
    expect(p.primary).toBe('wide');
    expect(p.metrics.minutesAboveBaseline).toBeGreaterThanOrEqual(PATTERN_RULES.wideMinutes);
    // explicitly not the other three
    expect(p.hits.some((h) => h.key === 'spike')).toBe(false);
    expect(p.hits.some((h) => h.key === 'stuck')).toBe(false);
    expect(p.hits.some((h) => h.key === 'crash')).toBe(false);
  });

  it('calls a curve that never returns ค้าง, and ranks it above พุ่ง', () => {
    // rises fast AND is still 40 above baseline at the 3-hour mark
    const values = [...LEAD, 115, 145, 170, 185, 190, 186, 178, 170, 165, 160, 156, 152,
      150, 148, 147, 146, 145, 145, 144, 144, 143, 143, 142, 142, 141, 141, 141, 140,
      140, 140, 140, 140, 140, 140, 140, 140, ...flat(140, 8)];
    const p = classifyAt(values, 24);
    expect(p.primary).toBe('stuck');
    expect(p.metrics.at180Delta).toBeGreaterThanOrEqual(PATTERN_RULES.stuckAt180Above);
    // the spike is real too, but ค้าง is the one to work on first
    expect(p.also).toContain('spike');
  });

  it('calls a dip under the starting line ตก, ahead of every other shape', () => {
    const values = [...LEAD, 118, 145, 168, 175, 170, 152, 130, 108, 92, 80, 76, 78,
      84, 92, 98, 100, ...flat(100, 36)];
    const p = classifyAt(values, 24);
    expect(p.primary).toBe('crash');
    expect(p.metrics.nadirAfterPeakDelta).toBeLessThanOrEqual(-PATTERN_RULES.crashBelowBaseline);
  });

  it('calls a small clean bump เรียบ and offers nothing to fix', () => {
    const values = [...LEAD, 104, 112, 118, 120, 118, 112, 106, 102, 100, ...flat(100, 43)];
    const p = classifyAt(values, 24);
    expect(p.primary).toBe('flat');
    expect(p.skippedReasonTh).toBeNull();
  });
});

describe('refusing to guess', () => {
  it('returns no shape when the window has too few readings', () => {
    // meal marked 20 minutes before the file ends
    const values = [...flat(100, 40), 110, 130, 150, 160];
    const r = build(values);
    const rs = readingsOf(r);
    const t = rs[rs.length - 4].t;
    const p = classifyMeal(t, mealResponse('m1', t, rs), rs);
    expect(p.primary).toBeNull();
    expect(p.skippedReasonTh).toContain('ยังไม่พอ');
  });

  it('returns no shape for a rise that is between the shapes', () => {
    // +45 (over flat, under spike), peaks slowly, back down well before 3h,
    // and not up long enough to be wide
    const values = [...LEAD, 104, 112, 122, 132, 140, 145, 143, 136, 126, 116, 106, 100,
      ...flat(100, 40)];
    const p = classifyAt(values, 24);
    expect(p.primary).toBeNull();
    expect(p.skippedReasonTh).toContain('ไม่เข้าเกณฑ์');
  });

  it('keeps "could not see" and "is not one of the four" as different answers', () => {
    // Shown as one number, a coach reads "the tool failed" when in fact the meal
    // was read perfectly well and simply is not a named shape.
    const thin = [...flat(100, 40), 110, 130, 150, 160];
    const r = build(thin);
    const rs = readingsOf(r);
    const tThin = rs[rs.length - 4].t;
    const a = classifyMeal(tThin, mealResponse('a', tThin, rs), rs);
    expect(a.noShape).toBe('thin-data');

    const between = [...LEAD, 104, 112, 122, 132, 140, 145, 143, 136, 126, 116, 106, 100, ...flat(100, 40)];
    const b = classifyAt(between, 24);
    expect(b.noShape).toBe('between-shapes');

    const snap = summarisePatterns([a, b], [], { medsLowering: false });
    expect(snap.thinData).toBe(1);
    expect(snap.betweenShapes).toBe(1);
    expect(snap.judged).toBe(0);
  });

  it('never reports a gap as time spent high', () => {
    // a 2-hour hole in the middle of the window must not be counted as "above"
    const rs: Reading[] = [
      { t: 0, v: 100, flag: 'ok' }, { t: 5, v: 100, flag: 'ok' }, { t: 10, v: 100, flag: 'ok' },
      { t: 15, v: 160, flag: 'ok' }, { t: 20, v: 165, flag: 'ok' },
      // 2-hour gap
      { t: 140, v: 162, flag: 'ok' }, { t: 145, v: 160, flag: 'ok' }, { t: 150, v: 158, flag: 'ok' },
      { t: 155, v: 156, flag: 'ok' }, { t: 160, v: 155, flag: 'ok' }, { t: 165, v: 154, flag: 'ok' },
      { t: 170, v: 153, flag: 'ok' }, { t: 175, v: 152, flag: 'ok' }, { t: 180, v: 151, flag: 'ok' },
    ];
    const p = classifyMeal(10, mealResponse('m1', 10, rs), rs);
    // 5+5 min of real coverage above the line at the front, ~40 at the back —
    // nowhere near the 150 that would make it "กว้าง" if the hole were counted
    expect(p.metrics.minutesAboveBaseline).toBeLessThan(PATTERN_RULES.wideMinutes);
  });
});

describe('snapshot across meals', () => {
  const mk = (id: string, t: number): MealMarker => ({
    id, t, label: id, kind: 'lunch', eatingOrder: 'unknown', walkedAfter: false,
    createdAt: 0, updatedAt: 0,
  });

  it('refuses to name a dominant shape off fewer than three meals', () => {
    const snap = summarisePatterns(
      [
        { markerId: 'a', primary: 'spike', also: [], hits: [], noShape: null, skippedReasonTh: null,
          metrics: { delta: 80, minutesToPeak: 30, minutesAboveBaseline: 60, at180Delta: 2, nadirAfterPeakDelta: -2 } },
        { markerId: 'b', primary: 'spike', also: [], hits: [], noShape: null, skippedReasonTh: null,
          metrics: { delta: 75, minutesToPeak: 35, minutesAboveBaseline: 55, at180Delta: 1, nadirAfterPeakDelta: -1 } },
      ],
      [mk('a', 0), mk('b', 500)],
      { medsLowering: false },
    );
    expect(snap.judged).toBe(2);
    expect(snap.dominant).toBeNull();
    expect(snap.headlineTh).toContain('ยังน้อยเกิน');
  });

  it('names the most common non-flat shape once there are enough meals', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id, i) => ({
      markerId: id, primary: (i === 3 ? 'flat' : 'stuck') as 'flat' | 'stuck', also: [], hits: [], noShape: null,
      skippedReasonTh: null,
      metrics: { delta: 70, minutesToPeak: 40, minutesAboveBaseline: 120, at180Delta: 40, nadirAfterPeakDelta: 5 },
    }));
    const snap = summarisePatterns(rows, rows.map((r, i) => mk(r.markerId, i * 600)), { medsLowering: false });
    expect(snap.dominant).toBe('stuck');
    expect(snap.counts.stuck).toBe(3);
    expect(snap.firstMoveTh).toBeTruthy();
  });

  it('never picks เรียบ as the thing to work on', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id, i) => ({
      markerId: id, primary: (i === 0 ? 'spike' : 'flat') as 'flat' | 'spike', also: [], hits: [], noShape: null,
      skippedReasonTh: null,
      metrics: { delta: 20, minutesToPeak: 40, minutesAboveBaseline: 20, at180Delta: 0, nadirAfterPeakDelta: 0 },
    }));
    const snap = summarisePatterns(rows, rows.map((r, i) => mk(r.markerId, i * 600)), { medsLowering: false });
    expect(snap.dominant).toBe('spike');
  });

  it('flags a crash as the prescriber’s call when the case is on medicine', () => {
    const rows = [{
      markerId: 'a', primary: 'crash' as const, also: [], hits: [], noShape: null, skippedReasonTh: null,
      metrics: { delta: 70, minutesToPeak: 30, minutesAboveBaseline: 40, at180Delta: -5, nadirAfterPeakDelta: -25 },
    }];
    expect(summarisePatterns(rows, [mk('a', 0)], { medsLowering: true }).crashNeedsPrescriber).toBe(true);
    expect(summarisePatterns(rows, [mk('a', 0)], { medsLowering: false }).crashNeedsPrescriber).toBe(false);
  });
});

describe('wired into the findings a coach reads', () => {
  function withMeals(values: number[], mealIdxs: number[], meds: 'yes' | 'no') {
    const r = build(values);
    const rs = readingsOf(r);
    const markers = mealIdxs.map((i, n) => ({
      id: `m${n}`, t: rs[i].t, label: `มื้อ ${n + 1}`, kind: 'lunch' as const,
      eatingOrder: 'unknown' as const, walkedAfter: false, createdAt: 0, updatedAt: 0,
    }));
    const responses = markers.map((m) => mealResponse(m.id, m.t, rs));
    return interpret(r, { meds, markers, responses });
  }

  const spikeMeal = [108, 130, 155, 172, 180, 178, 165, 148, 132, 118, 108, 102, ...flat(100, 36)];

  it('surfaces the dominant shape as a finding with its evidence', () => {
    // three identical spike meals, 4 hours apart
    const values = [...flat(100, 24), ...spikeMeal, ...spikeMeal, ...spikeMeal, ...flat(100, 60)];
    const out = withMeals(values, [24, 72, 120], 'no');
    expect(out.patterns?.dominant).toBe('spike');
    const f = out.findings.find((x) => x.id === 'pattern-spike');
    expect(f).toBeTruthy();
    expect(f!.basis).toBe('house');
    // the finding now speaks for the whole-window scan, not only marked meals
    expect(f!.evidenceTh).toContain('ช่วงที่น้ำตาลขึ้นและอ่านรูปร่างได้');
    expect(f!.evidenceTh).toContain('สแกนทั้งช่วงเวลาที่เลือก');
  });

  it('says on the sheet that the four words are ours, not medicine’s', () => {
    const values = [...flat(100, 24), ...spikeMeal, ...spikeMeal, ...spikeMeal, ...flat(100, 60)];
    const out = withMeals(values, [24, 72, 120], 'no');
    expect(out.limitationsTh.some((l) => l.includes('ไม่ใช่ศัพท์ทางการแพทย์'))).toBe(true);
  });

  it('escalates a post-meal crash when the case is on glucose-lowering medicine', () => {
    const crashMeal = [118, 145, 168, 175, 170, 152, 130, 108, 92, 80, 76, 78, 84, 92, 98, 100, ...flat(100, 32)];
    const values = [...flat(100, 24), ...crashMeal, ...crashMeal, ...crashMeal, ...flat(100, 60)];
    const out = withMeals(values, [24, 72, 120], 'yes');
    expect(out.escalate).toBe(true);
    const f = out.findings.find((x) => x.id === 'pattern-crash-meds')!;
    expect(f.severity).toBe('urgent');
    expect(f.actionTh).toContain('แพทย์ผู้สั่งยา');
  });

  it('produces no pattern block at all when no meals were marked', () => {
    const out = interpret(build(flat(105, 288)), { meds: 'no' });
    expect(out.patterns).toBeNull();
    expect(out.perMeal).toEqual([]);
  });

  it('never names a product or a dose in any pattern text', () => {
    const values = [...flat(100, 24), ...spikeMeal, ...spikeMeal, ...spikeMeal, ...flat(100, 60)];
    const out = withMeals(values, [24, 72, 120], 'no');
    const all = [
      out.patterns?.headlineTh ?? '', out.patterns?.firstMoveTh ?? '',
      ...(out.patterns?.linesTh ?? []),
      ...out.findings.filter((f) => f.id.startsWith('pattern-')).flatMap((f) => [f.titleTh, f.evidenceTh, f.actionTh ?? '']),
    ].join(' ');
    for (const banned of ['Nutrilite', 'อาหารเสริม', 'วิตามิน', 'มก. ต่อวัน', 'เม็ด', 'ซื้อ', 'ราคา', 'บาท']) {
      expect(all).not.toContain(banned);
    }
  });
});

describe('analysePatterns end to end', () => {
  it('pairs each response with its own marker and skips orphans', () => {
    const r = build([...flat(100, 24), ...[108, 130, 155, 172, 180, 178, 165, 148, 132, 118, 108, 102], ...flat(100, 60)]);
    const rs = readingsOf(r);
    const markers: MealMarker[] = [{
      id: 'real', t: rs[24].t, label: 'มื้อจริง', kind: 'lunch',
      eatingOrder: 'unknown', walkedAfter: false, createdAt: 0, updatedAt: 0,
    }];
    const responses = [
      mealResponse('real', rs[24].t, rs),
      mealResponse('ghost', rs[10].t, rs), // no marker with this id
    ];
    const { perMeal } = analysePatterns(markers, responses, rs, { medsLowering: false });
    expect(perMeal).toHaveLength(1);
    expect(perMeal[0].markerId).toBe('real');
  });
});
