import type { Locale } from './prefs';

/**
 * UI copy in both languages.
 *
 * Only chrome lives here — buttons, headings, empty states. Everything the
 * interpretation engine writes (findings, pattern verdicts, AGP notes) is
 * generated on the server in the requested language and arrives already
 * translated, because that copy has to stay next to the thresholds it
 * describes. Splitting it into a UI dictionary is how a threshold changes in
 * one language and not the other.
 *
 * Keys read as `area.thing` so a stray key is obvious in review.
 */
export const DICT = {
  'app.title': ['CGM Analyser', 'CGM Analyser'],
  'app.tagline': [
    'เครื่องมือของโค้ช UP Wellness สำหรับอ่านผลเครื่องวัดน้ำตาลต่อเนื่อง',
    'A UP Wellness coaching tool for reading continuous glucose monitor data',
  ],
  'app.disclaimer': [
    'เครื่องมือนี้ช่วยอ่านข้อมูลเพื่อพูดคุยเรื่องพฤติกรรม ไม่ใช่การวินิจฉัยโรค และไม่ใช้แทนคำแนะนำของแพทย์',
    'This tool reads data to support a conversation about habits. It is not a diagnosis and does not replace medical advice.',
  ],

  // ── settings ────────────────────────────────────────────────────────────
  'prefs.title': ['ตั้งค่าการแสดงผล', 'Display settings'],
  'prefs.open': ['ตั้งค่าการแสดงผล', 'Display settings'],
  'prefs.language': ['ภาษา', 'Language'],
  'prefs.theme': ['ธีม', 'Theme'],
  'prefs.theme.system': ['ตามระบบ', 'System'],
  'prefs.theme.light': ['สว่าง', 'Light'],
  'prefs.theme.dark': ['มืด', 'Dark'],
  'prefs.textSize': ['ขนาดตัวอักษร', 'Text size'],
  'prefs.textSize.smaller': ['เล็กลง', 'Smaller'],
  'prefs.textSize.larger': ['ใหญ่ขึ้น', 'Larger'],
  'prefs.textSize.reset': ['ขนาดมาตรฐาน', 'Reset to default'],
  'prefs.sample': ['ตัวอย่าง 120 mg/dL', 'Sample 120 mg/dL'],
  'prefs.note': [
    'ค่าที่ตั้งไว้จะถูกจำในเครื่องนี้ ไม่ได้ส่งออกไปไหน',
    'These settings are remembered on this device and are not sent anywhere.',
  ],

  // ── common ──────────────────────────────────────────────────────────────
  'common.close': ['ปิด', 'Close'],
  'common.cancel': ['ยกเลิก', 'Cancel'],
  'common.save': ['บันทึก', 'Save'],
  'common.delete': ['ลบ', 'Delete'],
  'common.back': ['ย้อนกลับ', 'Back'],
  'common.loading': ['กำลังโหลด…', 'Loading…'],
  'common.none': ['—', '—'],
  'common.settings': ['ตั้งค่า', 'Settings'],
} as const satisfies Record<string, readonly [string, string]>;

export type MsgKey = keyof typeof DICT;

/** Index into the tuple: 0 = th, 1 = en. */
const idx = (l: Locale) => (l === 'en' ? 1 : 0);

/**
 * Look up a key. Interpolates `{name}` placeholders. A missing key returns the
 * key itself rather than an empty string, so a gap shows up on screen during
 * review instead of silently rendering nothing.
 */
export function translate(locale: Locale, key: MsgKey, vars?: Record<string, string | number>): string {
  const entry = DICT[key] as readonly [string, string] | undefined;
  let s = entry ? entry[idx(locale)] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Locales the server will answer in. Anything else falls back to Thai. */
export function toServerLocale(l: unknown): Locale {
  return l === 'en' ? 'en' : 'th';
}
