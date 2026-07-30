import * as XLSX from 'xlsx';
import { coerceTime } from '@/lib/time';
import type { Reading, RejectedRow } from '@/lib/types';
import { DEVICE_CEILING } from './thresholds';

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 60_000;
export const MIN_READINGS = 12;

export class ParseError extends Error {
  constructor(readonly status: number, message: string, readonly detail?: unknown) {
    super(message);
  }
}

/** Strip BOM, spaces, punctuation and case so header matching survives real files. */
const normalise = (s: unknown) =>
  String(s ?? '')
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿]/g, '');

const TIME_KEYS = ['time', 'timestamp', 'datetime', 'devicetimestamp', 'date', 'เวลา', 'วันเวลา', 'วันที่'];
// `Glucosemg/dL` in the Ottai export has no space, which is exactly why we
// normalise instead of comparing literals.
const GLUCOSE_KEYS = [
  'glucosemgdl', 'glucosemmoll', 'glucose', 'bloodglucose', 'sensorglucose',
  'glucosevalue', 'historicglucose', 'ค่าน้ำตาล', 'น้ำตาล', 'sg',
];

interface HeaderHit {
  rowIdx: number;
  timeCol: number;
  glucoseCol: number;
  unit: 'mg/dL' | 'mmol/L';
}

function findHeader(rows: unknown[][]): HeaderHit | null {
  // Header is not guaranteed to be row 1 — a summary block above it is common.
  const limit = Math.min(rows.length, 10);
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!row) continue;
    let timeCol = -1, glucoseCol = -1, unit: 'mg/dL' | 'mmol/L' = 'mg/dL';
    for (let c = 0; c < row.length; c++) {
      const key = normalise(row[c]);
      if (!key) continue;
      if (timeCol < 0 && TIME_KEYS.includes(key)) timeCol = c;
      if (glucoseCol < 0 && GLUCOSE_KEYS.some((k) => key === k || key.startsWith(k))) {
        glucoseCol = c;
        if (key.includes('mmol')) unit = 'mmol/L';
      }
    }
    if (timeCol >= 0 && glucoseCol >= 0) return { rowIdx: r, timeCol, glucoseCol, unit };
  }
  return null;
}

function coerceGlucose(cell: unknown, unit: 'mg/dL' | 'mmol/L'): number | null {
  let n: number;
  if (typeof cell === 'number') {
    n = cell;
  } else {
    const s = String(cell ?? '').trim().replace(/,/g, '');
    if (!s) return null;
    // Some exports clamp the ends to words instead of numbers.
    if (/^(hi|high|>\s*\d+)$/i.test(s)) return DEVICE_CEILING;
    if (/^(lo|low|<\s*\d+)$/i.test(s)) return 36;
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    n = parseFloat(s);
  }
  if (!Number.isFinite(n)) return null;
  if (unit === 'mmol/L') n = n * 18.0182;
  // Outside this, it is not a glucose reading — dropping beats letting it skew
  // the mean, and the count of dropped rows is reported to the user.
  if (n < 10 || n > 700) return null;
  return Math.round(n * 10) / 10;
}

/** A workbook is a zip; anything else is a mislabelled file. */
function assertLooksLikeWorkbook(buf: Buffer, name: string) {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  const looksCsv = /\.csv$/i.test(name);
  if (!isZip && !looksCsv) {
    throw new ParseError(422, 'ไฟล์นี้ไม่ใช่ไฟล์ Excel หรือ CSV — กรุณาส่งออกไฟล์จากแอปเครื่องวัดใหม่แล้วลองอีกครั้ง');
  }
}

export interface ParseOutput {
  readings: Reading[];
  rejected: RejectedRow[];
  duplicatesDropped: number;
  rowsRead: number;
  unitDetected: 'mg/dL' | 'mmol/L';
  unitConverted: boolean;
  sheetName: string;
}

export function parseWorkbook(buf: Buffer, sourceName = 'upload'): ParseOutput {
  if (buf.byteLength > MAX_BYTES) {
    throw new ParseError(413, `ไฟล์ใหญ่เกินที่รับได้ (สูงสุด ${MAX_BYTES / 1024 / 1024} MB) — ลองส่งออกเฉพาะช่วงล่าสุด`);
  }
  assertLooksLikeWorkbook(buf, sourceName);

  let wb: XLSX.WorkBook;
  try {
    // raw + no cellDates: we want the untouched cell so lib/time.ts decides how
    // to read it, rather than letting the reader guess a timezone for us.
    wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: true, dense: true });
  } catch {
    throw new ParseError(422, 'เปิดไฟล์ไม่สำเร็จ ไฟล์อาจเสียหาย — ลองส่งออกจากแอปเครื่องวัดใหม่');
  }

  // Do not trust '!ref' or a dimension record: 9 of 13 real Ottai files have
  // none, and reading the range from it yields zero rows with no error at all.
  let rows: unknown[][] | null = null;
  let header: HeaderHit | null = null;
  let sheetName = '';
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const candidate = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: null });
    const hit = findHeader(candidate);
    if (hit) { rows = candidate; header = hit; sheetName = name; break; }
  }
  if (!rows || !header) {
    throw new ParseError(
      422,
      'หาคอลัมน์เวลาและค่าน้ำตาลในไฟล์นี้ไม่พบ — ไฟล์ต้องมีคอลัมน์เวลา (เช่น Time) และคอลัมน์ค่าน้ำตาล (เช่น Glucose mg/dL)',
    );
  }

  const dataRows = rows.length - header.rowIdx - 1;
  if (dataRows > MAX_ROWS) {
    throw new ParseError(413, `จำนวนแถวเกินที่รองรับ (${MAX_ROWS.toLocaleString('th-TH')} แถว) — ลองแบ่งไฟล์เป็นช่วงสั้นลง`);
  }

  const parsed: Reading[] = [];
  const rejected: RejectedRow[] = [];
  for (let i = header.rowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const rawT = row[header.timeCol];
    const rawV = row[header.glucoseCol];
    if (rawT == null && rawV == null) continue; // blank filler row
    const t = coerceTime(rawT);
    if (t == null) { rejected.push({ row: i + 1, reason: 'อ่านเวลาไม่ได้' }); continue; }
    const v = coerceGlucose(rawV, header.unit);
    if (v == null) { rejected.push({ row: i + 1, reason: 'อ่านค่าน้ำตาลไม่ได้' }); continue; }
    parsed.push({ t, v, flag: 'ok' });
  }

  if (parsed.length === 0) {
    throw new ParseError(422, 'ไม่พบข้อมูลน้ำตาลที่อ่านได้ในไฟล์นี้');
  }
  if (parsed.length < MIN_READINGS) {
    throw new ParseError(422, `มีข้อมูลเพียง ${parsed.length} ค่า — น้อยเกินกว่าจะสรุปอะไรได้ (ต้องมีอย่างน้อย ${MIN_READINGS} ค่า)`);
  }

  // The Ottai export is newest-first. Sorting has to happen before anything
  // else touches the array, or the chart runs backwards and gaps go negative.
  parsed.sort((a, b) => a.t - b.t || a.v - b.v);

  const readings: Reading[] = [];
  let duplicatesDropped = 0;
  for (const r of parsed) {
    const last = readings[readings.length - 1];
    if (last && last.t === r.t) {
      duplicatesDropped++;
      // Same minute, different value: keep the first but mark it, because one of
      // the two is wrong and we should not pretend to know which.
      if (last.v !== r.v) last.flag = 'suspect';
      continue;
    }
    readings.push(r);
  }

  return {
    readings,
    rejected,
    duplicatesDropped,
    rowsRead: dataRows,
    unitDetected: header.unit,
    unitConverted: header.unit === 'mmol/L',
    sheetName,
  };
}
