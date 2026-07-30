import { describe, expect, it } from 'vitest';
import { ParseError, parseWorkbook } from '@/server/cgm/parse';
import { analyse } from '@/server/cgm/analyse';
import { coerceTime, fmtDateTime } from '@/lib/time';
import { flat, makeWorkbook, realFixture, series } from './helpers';

const RAMP = [110, 101, 104, 96, 88, 92, 105, 118, 132, 121, 113, 108];

describe('header discovery', () => {
  it('reads the Ottai header, which has no space in Glucosemg/dL', () => {
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP));
    expect(parseWorkbook(buf).readings).toHaveLength(RAMP.length);
  });

  it('tolerates padding, case and a BOM on the header', () => {
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP), {
      timeHeader: '﻿  TIME  ',
      glucoseHeader: 'Glucose mg/dL',
    });
    expect(parseWorkbook(buf).readings).toHaveLength(RAMP.length);
  });

  it('accepts Thai column names', () => {
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP), {
      timeHeader: 'เวลา', glucoseHeader: 'ค่าน้ำตาล',
    });
    expect(parseWorkbook(buf).readings).toHaveLength(RAMP.length);
  });

  it('finds the header below a summary block instead of assuming row 1', () => {
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP), {
      preamble: [['Ottai CGM Report'], ['Device', 'B0E8E8C7CE73'], []],
    });
    expect(parseWorkbook(buf).readings).toHaveLength(RAMP.length);
  });

  it('looks past a sheet named something else', () => {
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP), { sheetName: 'Report' });
    expect(parseWorkbook(buf).readings).toHaveLength(RAMP.length);
  });

  it('explains which columns it wanted when it cannot find them', () => {
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP), {
      timeHeader: 'Column A', glucoseHeader: 'Column B',
    });
    try {
      parseWorkbook(buf);
      expect.unreachable('should have refused the file');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).message).toContain('Glucose');
    }
  });
});

describe('ordering', () => {
  it('reverses the newest-first export before anything else touches it', () => {
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP));
    const { readings } = parseWorkbook(buf);
    for (let i = 1; i < readings.length; i++) expect(readings[i].t).toBeGreaterThan(readings[i - 1].t);
    expect(readings[0].v).toBe(110);
    expect(readings[readings.length - 1].v).toBe(108);
  });

  it('gives identical results whichever order the rows arrive in', () => {
    const asc = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP, { newestFirst: false }));
    const desc = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP));
    const a = parseWorkbook(asc).readings, b = parseWorkbook(desc).readings;
    expect(a.map((r) => [r.t, r.v])).toEqual(b.map((r) => [r.t, r.v]));
  });
});

describe('time handling', () => {
  it('reads the wall clock without shifting it', () => {
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 19, h: 15, mi: 19 }, RAMP, { newestFirst: false }));
    const { readings } = parseWorkbook(buf);
    expect(fmtDateTime(readings[0].t)).toBe('2026-07-19 15:19');
  });

  it('gives the same answer under any machine timezone', () => {
    // Guards the failure that produces no error at all: a local-time reading
    // shifts every AGP bin by the offset and the report just looks wrong.
    // `npm run test:tz` runs the suite under UTC and Asia/Bangkok.
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP, { newestFirst: false }));
    const t = parseWorkbook(buf).readings[0].t;
    expect(fmtDateTime(t)).toBe('2026-07-08 22:28');
    expect(t).toBe(Date.UTC(2026, 6, 8, 22, 28) / 60000);
  });

  it('accepts seconds in the timestamp', () => {
    const rows = RAMP.map((v, i) => ({ time: `2026-07-08 22:${String(28 + i).padStart(2, '0')}:35`, glucose: String(v) }));
    expect(parseWorkbook(makeWorkbook(rows)).readings).toHaveLength(RAMP.length);
  });

  it('refuses an ambiguous day/month date rather than guessing', () => {
    // 08/07/2026 could be 8 July or 7 August. Guessing wrong moves every
    // reading a month, so the row is rejected and counted rather than accepted.
    const ambiguous = RAMP.map((v, i) => ({ time: `08/07/2026 ${String(1 + i).padStart(2, '0')}:00`, glucose: String(v) }));
    const readable = series({ y: 2026, mo: 7, d: 20, h: 8, mi: 0 }, RAMP, { newestFirst: false });
    const out = parseWorkbook(makeWorkbook([...ambiguous, ...readable]));
    expect(out.readings).toHaveLength(RAMP.length);
    expect(out.rejected).toHaveLength(RAMP.length);
    expect(out.rejected[0].reason).toContain('เวลา');
  });

  it('reads an unambiguous day-first date', () => {
    const rows = RAMP.map((v, i) => ({ time: `19/07/2026 ${String(1 + i).padStart(2, '0')}:05`, glucose: String(v) }));
    const out = parseWorkbook(makeWorkbook(rows));
    expect(fmtDateTime(out.readings[0].t)).toBe('2026-07-19 01:05');
  });

  it('rounds a serial that lands seconds short of a minute boundary', () => {
    // 2026-07-08 22:28 written as 22:27:40 — the exact shape SheetJS produces at
    // UTC+14. Truncating puts the reading in 22:27, one AGP bin adrift.
    const serial = 46211 + (22 * 3600 + 27 * 60 + 40) / 86400;
    const rows = RAMP.map((v, i) => ({ time: serial + (i * 5) / 1440, glucose: v }));
    const out = parseWorkbook(makeWorkbook(rows));
    expect(fmtDateTime(out.readings[0].t)).toBe('2026-07-08 22:28');
  });

  it('reads a date cell stored as a serial, the shape Excel leaves behind', () => {
    const rows = RAMP.map((v, i) => ({ time: new Date(2026, 6, 8, 22, 28 + i), glucose: v }));
    const out = parseWorkbook(makeWorkbook(rows));
    expect(out.readings).toHaveLength(RAMP.length);
    expect(fmtDateTime(out.readings[0].t)).toBe('2026-07-08 22:28');
  });

  it('keeps the digits when a reader hands back a Date object', () => {
    // This branch exists for readers that resolve cells to Dates. It must read the
    // local fields: the sensor wrote 22:28 on its own clock, and re-interpreting
    // that as an instant would slide the whole report by the host offset.
    expect(fmtDateTime(coerceTime(new Date(2026, 6, 8, 22, 28))!)).toBe('2026-07-08 22:28');
    expect(coerceTime(new Date('not a date'))).toBeNull();
  });
});

describe('glucose values', () => {
  it('accepts numeric cells identically to string cells', () => {
    const asText = parseWorkbook(makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP))).readings;
    const rows = RAMP.map((v, i) => ({ time: `2026-07-08 22:${String(28 + i).padStart(2, '0')}`, glucose: v }));
    const asNumber = parseWorkbook(makeWorkbook(rows)).readings;
    expect(asNumber.map((r) => r.v)).toEqual(asText.map((r) => r.v));
  });

  it('rejects impossible values and reports how many it dropped', () => {
    const rows = [
      { time: '2026-07-08 22:00', glucose: '-5' },
      { time: '2026-07-08 22:05', glucose: '0' },
      { time: '2026-07-08 22:10', glucose: '9999' },
      { time: '2026-07-08 22:15', glucose: '' },
      { time: '2026-07-08 22:20', glucose: 'n/a' },
      ...RAMP.map((v, i) => ({ time: `2026-07-08 23:${String(i * 5).padStart(2, '0')}`, glucose: String(v) })),
    ];
    const out = parseWorkbook(makeWorkbook(rows));
    expect(out.readings).toHaveLength(RAMP.length);
    expect(out.rejected).toHaveLength(5); // surfaced, never silently swallowed
  });

  it('maps LO and HI words to the device limits', () => {
    const rows = [
      { time: '2026-07-08 22:00', glucose: 'LO' },
      { time: '2026-07-08 22:05', glucose: 'HI' },
      ...RAMP.map((v, i) => ({ time: `2026-07-08 23:${String(i * 5).padStart(2, '0')}`, glucose: String(v) })),
    ];
    const out = parseWorkbook(makeWorkbook(rows));
    expect(out.readings[0].v).toBe(36);
    expect(out.readings[1].v).toBe(450);
  });

  it('converts mmol/L when the header says so', () => {
    // 6.4 read as mg/dL would report severe hypoglycaemia for a normal reading.
    const rows = [6.1, 5.8, 6.4, 7.2, 6.9, 6.0, 5.9, 6.3, 6.6, 7.0, 6.2, 5.7].map((v, i) => ({
      time: `2026-07-08 22:${String(i * 5).padStart(2, '0')}`, glucose: String(v),
    }));
    const out = parseWorkbook(makeWorkbook(rows, { glucoseHeader: 'Glucose mmol/L' }));
    expect(out.unitConverted).toBe(true);
    expect(out.readings[0].v).toBeCloseTo(6.1 * 18.0182, 1);
  });
});

describe('duplicates and refusals', () => {
  it('drops a repeated timestamp and counts it', () => {
    const rows = [...series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP)];
    const out = parseWorkbook(makeWorkbook([...rows, ...rows]));
    expect(out.readings).toHaveLength(RAMP.length);
    expect(out.duplicatesDropped).toBe(RAMP.length);
  });

  it('marks a repeated timestamp holding a different value as suspect', () => {
    const rows = [
      ...RAMP.map((v, i) => ({ time: `2026-07-08 22:${String(28 + i).padStart(2, '0')}`, glucose: String(v) })),
      { time: '2026-07-08 22:28', glucose: '250' },
    ];
    const out = parseWorkbook(makeWorkbook(rows));
    expect(out.readings.find((r) => r.flag === 'suspect')).toBeTruthy();
  });

  it('refuses a header-only file', () => {
    expect(() => parseWorkbook(makeWorkbook([]))).toThrow(ParseError);
  });

  it('refuses a file that is not a workbook at all', () => {
    expect(() => parseWorkbook(Buffer.from('%PDF-1.4 not a spreadsheet'), 'report.pdf')).toThrow(ParseError);
  });

  it('refuses a file with too few readings to say anything', () => {
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, [100, 105, 110]));
    expect(() => parseWorkbook(buf)).toThrow(/น้อยเกิน/);
  });
});

describe('quality checks through analyse()', () => {
  it('breaks the series at a gap instead of drawing a calm stretch', () => {
    const early = series({ y: 2026, mo: 7, d: 8, h: 8, mi: 0 }, RAMP, { newestFirst: false });
    const late = series({ y: 2026, mo: 7, d: 8, h: 16, mi: 0 }, RAMP, { newestFirst: false });
    const out = analyse(makeWorkbook([...early, ...late]), 'gap.xlsx');
    expect(out.quality.gaps).toHaveLength(1);
    expect(out.quality.gaps[0].minutes).toBeGreaterThan(400);
  });

  it('treats a long floor run as signal loss, keeping it out of the numbers', () => {
    // A drop from 104 straight to the floor, held for hours: the shape of
    // someone sleeping on the sensor, not of hypoglycaemia.
    const values = [104, 106, 105, ...flat(36, 40), 102, 108, 104, 101, 99, 105];
    const out = analyse(makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 0, mi: 0 }, values, { newestFirst: false })), 'floor.xlsx');
    expect(out.quality.qcNotes.some((n) => n.kind === 'floor-artifact')).toBe(true);
    expect(out.quality.excludedFromMetrics).toBe(40);
    expect(out.metrics.tbrUnder54).toBe(0);
  });

  it('keeps a censored low that arrived gradually', () => {
    const values = [90, 74, 61, 52, 44, 38, 36, 36, 41, 55, 68, 84, 96, 104];
    const out = analyse(makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 0, mi: 0 }, values, { newestFirst: false })), 'real-low.xlsx');
    expect(out.quality.qcNotes.some((n) => n.kind === 'floor-censored')).toBe(true);
    expect(out.metrics.tbrUnder54).toBeGreaterThan(0);
  });

  it('gives the same dataset id for the same readings and a different one otherwise', () => {
    const buf = makeWorkbook(series({ y: 2026, mo: 7, d: 8, h: 22, mi: 28 }, RAMP));
    // Filenames arrive as "... (1).xlsx" all the time; identity must not depend
    // on them or a re-download looks like a new client and markers vanish.
    expect(analyse(buf, 'OttaiCGM_ABC (1).xlsx').datasetId).toBe(analyse(buf, 'OttaiCGM_ABC.xlsx').datasetId);
    const other = makeWorkbook(series({ y: 2026, mo: 7, d: 9, h: 22, mi: 28 }, RAMP));
    expect(analyse(other, 'x.xlsx').datasetId).not.toBe(analyse(buf, 'x.xlsx').datasetId);
  });
});

/**
 * Golden regression against real wear data. The files are gitignored, so these
 * skip on a fresh clone rather than fail.
 */
describe('golden: normal wear (10.7 days, TIR 97%)', () => {
  const buf = realFixture('golden-normal.xlsx');
  it.skipIf(!buf)('reproduces every headline number', () => {
    const out = analyse(buf!, 'golden-normal.xlsx');
    const m = out.metrics;
    expect(out.quality.rowsUsed).toBe(3083);
    expect(fmtDateTime(m.firstT)).toBe('2026-07-08 22:28');
    expect(fmtDateTime(m.lastT)).toBe('2026-07-19 15:19');
    expect(out.quality.spanDays).toBeCloseTo(10.7, 1);
    expect(out.quality.intervalMinutes).toBe(5);
    expect(out.quality.capturePct).toBeCloseTo(100, 0);
    expect(m.mean).toBeCloseTo(115.0071, 3);
    expect(m.sd).toBeCloseTo(19.9193, 3);
    expect(m.cv).toBeCloseTo(17.3201, 3);
    expect(m.gmi!).toBeCloseTo(6.0610, 3);
    expect(m.tir70_180).toBeCloseTo(97.0808, 3);
    expect(m.titr70_140).toBeCloseTo(88.7447, 3);
    expect(m.tbrUnder70).toBeCloseTo(2.1083, 3);
    expect(m.tbrUnder54).toBeCloseTo(0.2919, 3);
    expect(m.tarOver180).toBeCloseTo(0.8109, 3);
    expect(m.tarOver250).toBeCloseTo(0, 6);
    expect(m.min).toBe(47);
    expect(m.max).toBe(212);
  });

  it.skipIf(!buf)('keeps the three headline percentages summing to 100', () => {
    const m = analyse(buf!, 'g.xlsx').metrics;
    expect(m.tbrUnder70 + m.tir70_180 + m.tarOver180).toBeCloseTo(100, 6);
  });

  it.skipIf(!buf)('flags the span as under the fourteen days consensus wants', () => {
    expect(analyse(buf!, 'g.xlsx').quality.meetsFourteenDays).toBe(false);
  });

  it.skipIf(!buf)('marks the first and last partial days so they are not compared with full ones', () => {
    const daily = analyse(buf!, 'g.xlsx').daily;
    expect(daily[0].partial).toBe(true);                    // 8 Jul holds 19 readings
    expect(daily[daily.length - 1].partial).toBe(true);     // 19 Jul holds 184
    expect(daily.filter((d) => !d.partial).length).toBe(10);
  });
});

describe('golden: high wear (exercises the >250 band)', () => {
  const buf = realFixture('golden-high.xlsx');
  it.skipIf(!buf)('reports a non-zero very-high band', () => {
    // The normal file has 0% above 250, so that bucket could be broken and
    // still pass. This one keeps it honest.
    const m = analyse(buf!, 'golden-high.xlsx').metrics;
    expect(m.tarOver250).toBeGreaterThan(3);
    expect(m.cv).toBeGreaterThan(29);
    expect(m.tbrUnder70 + m.tir70_180 + m.tarOver180).toBeCloseTo(100, 6);
  });
});

describe('golden: floor run (110 readings pinned at 36)', () => {
  const buf = realFixture('golden-floorrun.xlsx');
  it.skipIf(!buf)('does not report a nine-hour severe low', () => {
    const out = analyse(buf!, 'golden-floorrun.xlsx');
    const raw = out.series.v.filter((v) => v <= 36).length;
    expect(raw).toBeGreaterThan(100);
    expect(out.quality.qcNotes.some((n) => n.kind === 'floor-artifact')).toBe(true);
    // Left unhandled this file announces TBR<54 = 2.69%, which would fire the
    // red banner and the emergency number at someone whose sensor came loose.
    expect(out.metrics.tbrUnder54).toBeLessThan(1);
  });
});
