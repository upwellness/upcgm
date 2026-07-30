import { describe, expect, it } from 'vitest';
import { interpret } from '@/server/cgm/interpret';
import { analyse } from '@/server/cgm/analyse';
import { makeWorkbook, series } from './helpers';
import type { AnalysisResult, MealMarker } from '@/lib/types';
import { mealResponse, readingsFromWire } from '@/lib/meal-response';

/**
 * The findings are what a coach reads out loud and what the case takes home, so
 * these tests are as much about what the tool must never say as about what it says.
 */

function buildResult(values: number[], startHour = 0): AnalysisResult {
  const rows = series({ y: 2026, mo: 7, d: 12, h: startHour, mi: 0 }, values);
  return analyse(makeWorkbook(rows), 'test.xlsx');
}

const steady = (v: number, n: number) => Array.from({ length: n }, () => v);

describe('ordering', () => {
  it('puts a severe low above everything else', () => {
    // 288 readings = one day, most of it fine, with a genuine slow low.
    const values = [...steady(110, 200), 95, 84, 72, 64, 58, 51, 49, 55, 68, 82, 100, ...steady(110, 77)];
    const r = buildResult(values);
    const out = interpret(r, { meds: 'no' });
    expect(out.escalate).toBe(true);
    expect(out.findings[0].severity).toBe('urgent');
    expect(out.findings[0].id).toMatch(/tbr54|severe-low-event/);
  });

  it('leads with the prescriber when the case is on glucose-lowering medicine', () => {
    const values = [...steady(110, 200), 95, 84, 72, 64, 58, 51, 49, 55, 68, 82, 100, ...steady(110, 77)];
    const out = interpret(buildResult(values), { meds: 'yes' });
    const urgent = out.findings.find((f) => f.severity === 'urgent')!;
    expect(urgent.actionTh).toContain('แพทย์');
  });

  it('reports a clean wear as good without inventing a problem', () => {
    const out = interpret(buildResult(steady(105, 288 * 4)), { meds: 'no' });
    expect(out.escalate).toBe(false);
    expect(out.findings.some((f) => f.id === 'tir-good')).toBe(true);
    expect(out.findings.every((f) => f.severity !== 'urgent')).toBe(true);
  });
});

describe('what it must never say', () => {
  const cases: Array<[string, number[]]> = [
    ['a clean wear', steady(105, 288 * 4)],
    ['a high wear', steady(240, 288 * 4)],
    ['a low wear', steady(58, 288 * 4)],
    ['a swinging wear', Array.from({ length: 288 * 4 }, (_, i) => (i % 12 < 6 ? 70 : 230))],
  ];

  for (const [name, values] of cases) {
    it(`never mentions a product, a dose or a diagnosis — ${name}`, () => {
      for (const meds of ['yes', 'no', 'unknown'] as const) {
        const out = interpret(buildResult(values), { meds });
        const text = [out.headlineTh, ...out.limitationsTh, ...out.findings.flatMap((f) => [f.titleTh, f.evidenceTh, f.actionTh ?? ''])].join(' ');
        // A tool that reads a sensor must not name a product or move a dose.
        expect(text).not.toMatch(/Nutrilite|อาหารเสริม|ผลิตภัณฑ์|สั่งซื้อ|ราคา|บาท/i);
        expect(text).not.toMatch(/เพิ่มยา|ลดยา|หยุดยา|ปรับขนาดยา/);
        expect(text).not.toMatch(/คุณเป็นเบาหวาน|วินิจฉัยว่า|รักษาให้หาย|หายขาด/);
      }
    });
  }

  it('always carries the two standing limitations', () => {
    const out = interpret(buildResult(steady(105, 288 * 4)), { meds: 'no' });
    expect(out.limitationsTh.some((l) => l.includes('ไม่ใช่ในเลือดโดยตรง'))).toBe(true);
    expect(out.limitationsTh.some((l) => l.includes('ไม่ใช่การวินิจฉัย'))).toBe(true);
  });

  it('says so when the medication question was skipped', () => {
    const out = interpret(buildResult(steady(105, 288 * 4)), { meds: 'unknown' });
    expect(out.limitationsTh.some((l) => l.includes('ยังไม่ได้ระบุ'))).toBe(true);
  });
});

describe('provenance', () => {
  it('labels every finding as consensus or our own', () => {
    const out = interpret(buildResult(steady(105, 288 * 4)), { meds: 'no' });
    for (const f of out.findings) expect(['consensus', 'house']).toContain(f.basis);
  });

  it('marks the overnight window as our own definition, not a standard', () => {
    const values = [...steady(110, 20), 90, 64, 88, ...steady(110, 265)];
    // 00:00 start puts the dip inside our 00:00–06:00 night window.
    const out = interpret(buildResult(values), { meds: 'no' });
    const overnight = out.findings.find((f) => f.id === 'overnight-low');
    if (overnight) expect(overnight.basis).toBe('house');
  });
});

describe('short windows', () => {
  it('withholds percentage-based findings when the span cannot support them', () => {
    const out = interpret(buildResult(steady(105, 24)), { meds: 'no' }); // 2 hours
    expect(out.findings.some((f) => f.id === 'tir-good' || f.id === 'tir-low')).toBe(false);
    expect(out.limitationsTh.join(' ')).toMatch(/สั้น/);
  });
});

describe('meal findings', () => {
  it('names the worst meal and dates it', () => {
    const values = [...steady(100, 100), 100, 120, 150, 175, 168, 140, 118, 102, ...steady(100, 180)];
    const r = buildResult(values);
    const readings = readingsFromWire(r.series);
    const markerT = readings[100].t;
    const marker: MealMarker = {
      id: 'm1', t: markerT, label: 'ข้าวมันไก่', kind: 'lunch',
      eatingOrder: 'carb-first', walkedAfter: false, createdAt: 0, updatedAt: 0,
    };
    const out = interpret(r, { meds: 'no', markers: [marker], responses: [mealResponse('m1', markerT, readings)] });
    const meal = out.findings.find((f) => f.id === 'meal-peak')!;
    expect(meal.titleTh).toContain('ข้าวมันไก่');
    // Without a date, two meals with the same name are indistinguishable.
    expect(meal.titleTh).toMatch(/ก\.ค\./);
    expect(meal.evidenceTh).toMatch(/\+\d+/);
    expect(meal.actionTh).toBeTruthy();
  });

  it('says nothing about meals when none are marked', () => {
    const out = interpret(buildResult(steady(105, 288 * 4)), { meds: 'no' });
    expect(out.findings.some((f) => f.id === 'meal-peak')).toBe(false);
  });
});

describe('data quality surfaces as a finding', () => {
  it('flags a wear shorter than the consensus window', () => {
    const out = interpret(buildResult(steady(105, 288 * 4)), { meds: 'no' });
    const span = out.findings.find((f) => f.id === 'data-span')!;
    expect(span.evidenceTh).toContain('14');
  });
});
