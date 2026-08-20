import { describe, expect, it } from 'vitest';
import { BANDS, BAND_BY_KEY, METRIC_ABBR, abbrTitle, bandAbbrTitle } from '@/lib/bands';
import { computeMetrics } from '@/server/cgm/metrics';
import type { Reading } from '@/lib/types';

const readings = (values: number[]): Reading[] =>
  values.map((v, i) => ({ t: Date.UTC(2026, 6, 12) / 60000 + i * 5, v, flag: 'ok' as const }));

/**
 * The promise here is not "there are some letters next to the numbers" — it is
 * that a coach can hand this report to a doctor and the two of them are naming
 * the same figure. So the tags must match published nomenclature exactly, the
 * levels must not be swapped, and the server's wire must not drift from what
 * the screen prints.
 */

describe('standard nomenclature', () => {
  it('names each band the way the consensus does', () => {
    expect(BANDS.map((b) => b.abbr)).toEqual(['TBR L2', 'TBR L1', 'TIR', 'TAR L1', 'TAR L2']);
  });

  it('puts level 2 on the further-out band, not the nearer one', () => {
    // Getting this backwards would label a 45 mg/dL stretch as the milder tier.
    expect(BAND_BY_KEY.tbr54.hi).toBe(54);
    expect(BAND_BY_KEY.tbr54.abbr).toContain('L2');
    expect(BAND_BY_KEY.tbr70.abbr).toContain('L1');
    expect(BAND_BY_KEY.tbr70.hi).toBeGreaterThan(BAND_BY_KEY.tbr54.hi!);

    expect(BAND_BY_KEY.tar250.lo).toBe(250);
    expect(BAND_BY_KEY.tar250.abbr).toContain('L2');
    expect(BAND_BY_KEY.tar180.abbr).toContain('L1');
    expect(BAND_BY_KEY.tar250.lo!).toBeGreaterThan(BAND_BY_KEY.tar180.lo!);
  });

  it('expands every abbreviation, in both languages', () => {
    expect(abbrTitle('tir', 'en')).toBe('TIR = Time in Range');
    expect(abbrTitle('cv', 'en')).toBe('CV = Coefficient of Variation');
    expect(abbrTitle('gmi', 'en')).toBe('GMI = Glucose Management Indicator');
    expect(abbrTitle('titr', 'en')).toBe('TITR = Time in Tight Range');
    // Thai keeps the English expansion — that is the half that travels to a
    // doctor — and adds a gloss for a first-time reader.
    expect(abbrTitle('tir', 'th')).toContain('Time in Range');
    expect(abbrTitle('tir', 'th')).toContain('เวลาที่อยู่ในช่วงเป้าหมาย');
    // No Thai in an English build.
    for (const k of Object.keys(METRIC_ABBR) as (keyof typeof METRIC_ABBR)[]) {
      expect(abbrTitle(k, 'en'), k).not.toMatch(/[฀-๿]/);
    }
  });

  it('says which level a band tooltip is talking about', () => {
    // The tooltip opens with the very tag that was hovered, not a shortened one.
    expect(bandAbbrTitle('tbr54', 'en')).toBe('TBR L2 = Time Below Range, level 2');
    expect(bandAbbrTitle('tar180', 'en')).toBe('TAR L1 = Time Above Range, level 1');
    expect(bandAbbrTitle('tbr54', 'th')).toContain('ระดับ 2');
    // The in-target band has no level to qualify.
    expect(bandAbbrTitle('tir', 'en')).toBe('TIR = Time in Range');
  });

  it('mints no abbreviation for the metrics that have none', () => {
    // Average glucose and the 00:00–06:00 window carry no agreed short form.
    // Inventing one would give house vocabulary the look of consensus, which is
    // the confusion this table exists to prevent.
    expect(Object.keys(METRIC_ABBR)).not.toContain('mean');
    expect(Object.keys(METRIC_ABBR)).not.toContain('night');
  });

  it('sends the same names over the wire that the screen prints', () => {
    const m = computeMetrics(readings([45, 60, 110, 200, 300]), 'th');
    expect(m).not.toBeNull();
    expect(m!.buckets.map((b) => b.abbr)).toEqual(BANDS.map((b) => b.abbr));
    // and the same in English, since only the friendly half is translated
    const en = computeMetrics(readings([45, 60, 110, 200, 300]), 'en');
    expect(en!.buckets.map((b) => b.abbr)).toEqual(BANDS.map((b) => b.abbr));
  });
});
