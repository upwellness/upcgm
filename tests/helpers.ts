import * as XLSX from 'xlsx';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures');

/**
 * Real wear data is health information about real people, and this repo may be
 * cloned anywhere — so the golden files stay gitignored. Tests that need them
 * skip themselves rather than fail on a fresh clone.
 */
export function realFixture(name: string): Buffer | null {
  const path = join(FIXTURE_DIR, name);
  return existsSync(path) ? readFileSync(path) : null;
}

export interface SyntheticRow {
  time: string | number | Date | null;
  glucose: string | number | null;
}

/**
 * Excel serial from wall-clock fields. Written by hand because SheetJS's own
 * Date→serial conversion shifts with the host timezone — up to 48 seconds at
 * UTC−11 — which would make any date test assert SheetJS's quirk instead of ours.
 */
export function toExcelSerial(d: Date): number {
  const days = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
  const frac = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
  return days + frac;
}

/** Build a workbook in memory so edge cases are committed as code, not as files. */
export function makeWorkbook(
  rows: SyntheticRow[],
  opts?: { timeHeader?: string; glucoseHeader?: string; sheetName?: string; preamble?: unknown[][] },
): Buffer {
  const header = [opts?.timeHeader ?? 'Time', opts?.glucoseHeader ?? 'Glucosemg/dL'];
  const body = rows.map((r) => [r.time instanceof Date ? toExcelSerial(r.time) : r.time, r.glucose]);
  const aoa = [...(opts?.preamble ?? []), header, ...body];
  const ws = XLSX.utils.aoa_to_sheet(aoa as unknown[][]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts?.sheetName ?? 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-07-08 22:28` at a fixed 5-minute cadence, newest row first like Ottai. */
export function series(
  startISO: { y: number; mo: number; d: number; h: number; mi: number },
  values: number[],
  opts?: { newestFirst?: boolean; stepMinutes?: number },
): SyntheticRow[] {
  const step = opts?.stepMinutes ?? 5;
  const base = Date.UTC(startISO.y, startISO.mo - 1, startISO.d, startISO.h, startISO.mi);
  const rows = values.map((v, i) => {
    const d = new Date(base + i * step * 60000);
    const time = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    return { time, glucose: String(v) };
  });
  return opts?.newestFirst === false ? rows : rows.reverse();
}

/** Flat run of one value, for floor-clamp and zero-variance cases. */
export const flat = (value: number, count: number): number[] => Array.from({ length: count }, () => value);
