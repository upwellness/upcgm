/**
 * CGM timestamps are the sensor's wall-clock reading with no zone attached.
 * Everything downstream (AGP hour bins, night window, day splits) is expressed
 * in the wearer's local time, so converting to a real instant would shift the
 * whole report by the offset — silently, with no error.
 *
 * So: parse the digits, store minutes since the epoch as if they were UTC, and
 * read them back with UTC getters only. Same string on server and client, which
 * also removes any hydration mismatch.
 */

/** `YYYY-M-D` + `H:mm` with optional seconds, `/` or `-`, `T` or space. */
const ISO_LIKE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/;
/** `D/M/YYYY H:mm` — day first, the form Excel writes in Thai locales. */
const DMY = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/;

export type Minutes = number;

function toMinutes(y: number, mo: number, d: number, h: number, mi: number): Minutes | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  if (y < 2000 || y > 2100) return null;
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}

/**
 * Excel serial date → minutes. Excel counts days from 1899-12-30 (the offset
 * already absorbs Excel's fake 1900 leap day for every date after Feb 1900).
 */
function fromSerial(serial: number): Minutes | null {
  if (serial < 20000 || serial > 80000) return null;
  // Round to the nearest minute rather than truncating. A serial is a fraction of
  // a day, and writers do not all produce exact ones — SheetJS itself, running at
  // UTC+14, writes 22:28 as 22:27:40. CGM readings sit on whole minutes, so 20
  // seconds short of the boundary means the minute above, and truncating would
  // move the reading into the wrong minute, the wrong AGP bin, and potentially
  // the wrong side of a meal marker.
  const ms = Math.round(((serial - 25569) * 86400 * 1000) / 60000) * 60000;
  const d = new Date(ms);
  return toMinutes(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}

export function coerceTime(cell: unknown): Minutes | null {
  if (cell == null) return null;

  if (typeof cell === 'number' && Number.isFinite(cell)) return fromSerial(cell);

  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return null;
    // A Date built by a spreadsheet reader carries local fields; keep the digits.
    return toMinutes(cell.getFullYear(), cell.getMonth() + 1, cell.getDate(), cell.getHours(), cell.getMinutes());
  }

  const s = String(cell).trim().replace(/^﻿/, '');
  if (!s) return null;

  const iso = ISO_LIKE.exec(s);
  if (iso) return toMinutes(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5]);

  const dmy = DMY.exec(s);
  if (dmy) {
    const a = +dmy[1], b = +dmy[2];
    // Ambiguous when both fit a month. Refuse rather than guess: picking wrong
    // turns 1 July into 7 January and every date after it is wrong too.
    if (a <= 12 && b <= 12 && a !== b) return null;
    const day = a > 12 ? a : b, month = a > 12 ? b : a;
    return toMinutes(+dmy[3], month, day, +dmy[4], +dmy[5]);
  }

  // Numeric string holding a serial date.
  if (/^\d+(\.\d+)?$/.test(s)) return fromSerial(parseFloat(s));
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDateTime(t: Minutes): string {
  const d = new Date(t * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtTime(t: Minutes): string {
  const d = new Date(t * 60000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

/** `12 ก.ค.` — Thai short date, Buddhist year only when asked (reports show it). */
export function fmtThaiDate(t: Minutes, opts?: { year?: boolean; weekday?: boolean }): string {
  const d = new Date(t * 60000);
  const head = opts?.weekday ? `${TH_DAYS[d.getUTCDay()]} ` : '';
  const tail = opts?.year ? ` ${d.getUTCFullYear() + 543}` : '';
  return `${head}${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]}${tail}`;
}

/** Minutes since midnight — the axis every AGP bin sits on. */
export const minuteOfDay = (t: Minutes): number => ((t % 1440) + 1440) % 1440;

/** Midnight of the day containing `t`, as minutes. */
export const startOfDay = (t: Minutes): Minutes => t - minuteOfDay(t);

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * `12 Jul` — the English twin of fmtThaiDate. The year is the one difference
 * that matters: Thai reports carry the Buddhist year, English ones must not.
 */
export function fmtEnDate(t: Minutes, opts?: { year?: boolean; weekday?: boolean }): string {
  const d = new Date(t * 60000);
  const head = opts?.weekday ? `${EN_DAYS[d.getUTCDay()]} ` : '';
  const tail = opts?.year ? ` ${d.getUTCFullYear()}` : '';
  return `${head}${d.getUTCDate()} ${EN_MONTHS[d.getUTCMonth()]}${tail}`;
}

/** Whichever short date the reader asked for. */
export function fmtDate(t: Minutes, locale: 'th' | 'en', opts?: { year?: boolean; weekday?: boolean }): string {
  return locale === 'en' ? fmtEnDate(t, opts) : fmtThaiDate(t, opts);
}

/** `2.1%` of a day → `30 นาที` / `30 min`; long spans read as `5 ชม. 24 นาที` / `5h 24m`. */
export function fmtDuration(minutes: number, locale: 'th' | 'en' = 'th'): string {
  const m = Math.round(minutes);
  const en = locale === 'en';
  if (m < 60) return en ? `${m} min` : `${m} นาที`;
  const h = Math.floor(m / 60), rest = m % 60;
  if (rest === 0) return en ? `${h}h` : `${h} ชม.`;
  return en ? `${h}h ${rest}m` : `${h} ชม. ${rest} นาที`;
}

/** Percent of a 24h day → minutes per day. 1% = 14.4 min. */
export const pctToMinutesPerDay = (pct: number): number => (pct / 100) * 1440;

/**
 * `<input type="datetime-local">` speaks the browser's local clock, but our
 * minutes are the *device's* wall clock as written in the file. Treating them as
 * the same thing is correct here and is the whole point of the Minutes type:
 * a marker at 12:30 means the coach's client ate at 12:30 on the sensor's clock,
 * whatever timezone the coach happens to be sitting in.
 */
export function toLocalInputValue(t: Minutes): string {
  const d = new Date(t * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Inverse of toLocalInputValue. Returns null on a half-typed value. */
export function fromLocalInputValue(value: string): Minutes | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
}
