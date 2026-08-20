/**
 * Client-safe band boundaries and colours, for drawing only.
 *
 * These five numbers are published consensus and appear on every AGP report in
 * the world, so having them in the bundle costs nothing. What stays on the
 * server is the part with judgement in it: which readings are fit to count, how
 * a window is gated, and what any of it means (server/cgm/*).
 *
 * Every zone carries two colours because three of the brand hues fail contrast
 * as text on cream — `fill` paints areas, `ink` paints anything readable.
 */

export interface Band {
  key: 'tbr54' | 'tbr70' | 'tir' | 'tar180' | 'tar250';
  labelTh: string;
  labelEn: string;
  /** Consensus nomenclature for this band — see METRIC_ABBR below. */
  abbr: string;
  shortTh: string;
  shortEn: string;
  lo: number | null;
  hi: number | null;
  fill: string;
  ink: string;
  /** the soft wash behind the chart */
  wash: string;
}

export const BANDS: Band[] = [
  { key: 'tbr54', labelTh: 'ต่ำมาก · ต่ำกว่า 54', labelEn: 'Very low · below 54', abbr: 'TBR L2', shortTh: '<54', shortEn: '<54', lo: null, hi: 54, fill: 'rgb(var(--c-zone-vlow))', ink: 'rgb(var(--c-zone-vlow))', wash: 'rgba(58,110,134,.16)' },
  { key: 'tbr70', labelTh: 'ต่ำ · 54–69', labelEn: 'Low · 54–69', abbr: 'TBR L1', shortTh: '54–69', shortEn: '54–69', lo: 54, hi: 70, fill: 'rgb(var(--c-zone-low))', ink: 'rgb(var(--c-zone-low))', wash: 'rgba(58,110,134,.10)' },
  { key: 'tir', labelTh: 'อยู่ในเป้าหมาย · 70–180', labelEn: 'In target · 70–180', abbr: 'TIR', shortTh: '70–180', shortEn: '70–180', lo: 70, hi: 180, fill: 'rgb(var(--c-zone-in))', ink: 'rgb(var(--c-zone-in-ink))', wash: 'rgba(62,142,90,.09)' },
  { key: 'tar180', labelTh: 'สูง · 181–250', labelEn: 'High · 181–250', abbr: 'TAR L1', shortTh: '181–250', shortEn: '181–250', lo: 180, hi: 250, fill: 'rgb(var(--c-zone-high))', ink: 'rgb(var(--c-zone-high-ink))', wash: 'rgba(201,138,30,.11)' },
  { key: 'tar250', labelTh: 'สูงมาก · มากกว่า 250', labelEn: 'Very high · above 250', abbr: 'TAR L2', shortTh: '>250', shortEn: '>250', lo: 250, hi: null, fill: 'rgb(var(--c-zone-vhigh))', ink: 'rgb(var(--c-zone-vhigh))', wash: 'rgba(180,71,47,.13)' },
];

export const BAND_BY_KEY = Object.fromEntries(BANDS.map((b) => [b.key, b])) as Record<Band['key'], Band>;

/**
 * The standard name for each number, so a coach reading "อยู่ในช่วงเป้าหมาย" can
 * match it to what a doctor's note, a Libre or Dexcom printout, or a paper calls
 * the same figure. One registry, because the dashboard, the A4 handout and the
 * text sent to the model must not drift apart on what a metric is called.
 *
 * Sources: TIR / TBR / TAR / CV / GMI from the international consensus
 * (Battelino et al., Diabetes Care 2019); TITR from Battelino et al., Lancet
 * Diabetes & Endocrinology 2023.
 *
 * Average glucose and the overnight window are deliberately absent. Neither has
 * an agreed abbreviation, and minting one would give house vocabulary the look
 * of standard vocabulary — the exact confusion this table exists to prevent.
 */
export const METRIC_ABBR = {
  tir: { abbr: 'TIR', en: 'Time in Range', th: 'เวลาที่อยู่ในช่วงเป้าหมาย' },
  titr: { abbr: 'TITR', en: 'Time in Tight Range', th: 'เวลาที่อยู่ในช่วงแคบ' },
  tbr: { abbr: 'TBR', en: 'Time Below Range', th: 'เวลาที่ต่ำกว่าช่วงเป้าหมาย' },
  tar: { abbr: 'TAR', en: 'Time Above Range', th: 'เวลาที่สูงกว่าช่วงเป้าหมาย' },
  cv: { abbr: 'CV', en: 'Coefficient of Variation', th: 'สัมประสิทธิ์ความแปรปรวน' },
  gmi: { abbr: 'GMI', en: 'Glucose Management Indicator', th: 'ตัวชี้วัดการจัดการน้ำตาลจากค่าเฉลี่ย' },
  sd: { abbr: 'SD', en: 'Standard Deviation', th: 'ส่วนเบี่ยงเบนมาตรฐาน' },
  agp: { abbr: 'AGP', en: 'Ambulatory Glucose Profile', th: 'ภาพรวมน้ำตาลของวันปกติ' },
} as const;

export type MetricAbbrKey = keyof typeof METRIC_ABBR;

/**
 * What the abbreviation stands for, for a tooltip. The English expansion is the
 * part that carries across a doctor's desk, so it is shown in both languages;
 * the Thai gloss rides along for a reader meeting the term for the first time.
 */
export function abbrTitle(key: MetricAbbrKey, locale: 'th' | 'en'): string {
  const m = METRIC_ABBR[key];
  return locale === 'en' ? `${m.abbr} = ${m.en}` : `${m.abbr} = ${m.en} (${m.th})`;
}

/**
 * The same, for a range band. The level rides inside the expansion rather than
 * trailing it, so the tooltip opens with exactly the tag the reader hovered:
 * "TBR L2 = Time Below Range, level 2".
 */
export function bandAbbrTitle(key: Band['key'], locale: 'th' | 'en'): string {
  const b = BAND_BY_KEY[key];
  const base = (key.startsWith('tbr') ? 'tbr' : key.startsWith('tar') ? 'tar' : 'tir') as MetricAbbrKey;
  const m = METRIC_ABBR[base];
  const level = b.abbr.endsWith('L2') ? 2 : b.abbr.endsWith('L1') ? 1 : 0;
  const en = level ? `${m.en}, level ${level}` : m.en;
  const th = level ? `${m.th} ระดับ ${level}` : m.th;
  return locale === 'en' ? `${b.abbr} = ${en}` : `${b.abbr} = ${en} (${th})`;
}

/** Must match classify() in server/cgm/metrics.ts, including the boundaries. */
export function bandOf(v: number): Band {
  if (v < 54) return BAND_BY_KEY.tbr54;
  if (v < 70) return BAND_BY_KEY.tbr70;
  if (v <= 180) return BAND_BY_KEY.tir;
  if (v <= 250) return BAND_BY_KEY.tar180;
  return BAND_BY_KEY.tar250;
}

/**
 * Fixed Y axis. An auto-scaled axis makes a flat 100–120 day look as dramatic as
 * a 60–300 day, which is the single easiest way for a chart to lie to a coach.
 * Values outside the axis are drawn at the edge with a marker, never clipped
 * away silently.
 */
export const Y_MIN = 40;
export const Y_MAX = 260;
export const GRID_LINES = [54, 70, 140, 180, 250];

export const TIGHT_LO = 70;
export const TIGHT_HI = 140;

export const SEVERITY_STYLE = {
  urgent: { dot: 'rgb(var(--c-zone-vhigh))', chip: 'rgba(180,71,47,.12)', ink: 'rgb(var(--c-zone-vhigh))', labelTh: 'ต้องคุยก่อน', labelEn: 'Talk about first' },
  attention: { dot: 'rgb(var(--c-zone-high))', chip: 'rgba(201,138,30,.13)', ink: 'rgb(var(--c-zone-high-ink))', labelTh: 'ควรดู', labelEn: 'Worth a look' },
  watch: { dot: 'rgb(var(--c-zone-low))', chip: 'rgba(58,110,134,.12)', ink: 'rgb(var(--c-zone-low))', labelTh: 'เฝ้าดู', labelEn: 'Keep an eye on' },
  good: { dot: 'rgb(var(--c-zone-in))', chip: 'rgba(62,142,90,.12)', ink: 'rgb(var(--c-zone-in-ink))', labelTh: 'ผ่านเกณฑ์', labelEn: 'Meets the goal' },
} as const;

/**
 * Colours and glyphs for the four shapes. Presentation only — the rules that
 * decide which shape a meal *is* live in server/cgm/patterns.ts and never reach
 * the browser. A tiny inline sketch of each curve rides along because the whole
 * teaching device is "look at the shape", and a coloured word is not a shape.
 */
export const PATTERN_STYLE = {
  spike: { labelTh: 'พุ่ง', labelEn: 'Spike', ink: 'rgb(var(--c-zone-high-ink))', chip: 'rgba(201,138,30,.14)',
    path: 'M2 20 L14 20 C18 20 19 3 24 3 C29 3 30 19 34 19 L58 19' },
  wide: { labelTh: 'กว้าง', labelEn: 'Wide', ink: 'rgb(var(--c-pattern-wide))', chip: 'rgba(201,138,30,.10)',
    path: 'M2 20 L12 20 C20 20 20 8 28 8 L38 8 C46 8 46 19 54 19 L58 19' },
  stuck: { labelTh: 'ค้าง', labelEn: 'Stuck', ink: 'rgb(var(--c-zone-vhigh))', chip: 'rgba(180,71,47,.12)',
    path: 'M2 20 L11 20 C17 20 16 4 23 4 C30 4 31 12 38 13 L58 13' },
  crash: { labelTh: 'ตก', labelEn: 'Crash', ink: 'rgb(var(--c-zone-low))', chip: 'rgba(58,110,134,.12)',
    path: 'M2 17 L12 17 C17 17 18 3 23 3 C28 3 29 25 36 25 C44 25 48 19 58 18' },
  flat: { labelTh: 'เรียบ', labelEn: 'Flat', ink: 'rgb(var(--c-zone-in-ink))', chip: 'rgba(62,142,90,.12)',
    path: 'M2 19 L16 19 C24 19 24 13 32 13 C40 13 42 19 50 19 L58 19' },
} as const;

export type PatternKey = keyof typeof PATTERN_STYLE;

export const MEAL_KINDS = [
  { key: 'breakfast', labelTh: 'มื้อเช้า', labelEn: 'Breakfast', glyph: '🌅' },
  { key: 'lunch', labelTh: 'มื้อกลางวัน', labelEn: 'Lunch', glyph: '🍚' },
  { key: 'dinner', labelTh: 'มื้อเย็น', labelEn: 'Dinner', glyph: '🍽️' },
  { key: 'snack', labelTh: 'ของว่าง', labelEn: 'Snack', glyph: '🍪' },
  { key: 'drink', labelTh: 'เครื่องดื่ม', labelEn: 'Drink', glyph: '🥤' },
] as const;

/**
 * Percentages, with one rule: rounding must never manufacture a perfect score.
 * 99.96% in range is still six minutes a day out of range, and printing "100%"
 * on a page a patient shows a doctor erases those minutes. When rounding would
 * cross 100, we add a decimal instead of crossing it.
 */
export function fmtPct(n: number, decimals = 1): string {
  const rounded = n.toFixed(decimals);
  if (parseFloat(rounded) >= 100 && n < 100) {
    return `${(Math.floor(n * 100) / 100).toFixed(2)}%`;
  }
  return `${rounded}%`;
}


/**
 * Pick whichever language the reader asked for out of a `…Th`/`…En` pair.
 * Keeps components from spelling out the ternary at every label.
 */
/**
 * The label out of any `{labelTh, labelEn}` pair in this file, in the reader's
 * language. Typed rather than string-keyed like `pick` below, so a table that
 * forgets its English half fails to compile instead of silently printing Thai —
 * which is exactly how the severity and shape chips stayed Thai in an English
 * session for a release.
 */
export function label(o: { labelTh: string; labelEn: string }, locale: 'th' | 'en'): string {
  return locale === 'en' ? o.labelEn : o.labelTh;
}

export function pick<T extends Record<string, unknown>>(
  obj: T,
  base: string,
  locale: 'th' | 'en',
): string {
  const key = `${base}${locale === 'en' ? 'En' : 'Th'}`;
  return String(obj[key] ?? obj[`${base}Th`] ?? '');
}


/** Window preset labels, resolved on the client so switching language is instant. */
const WINDOW_LABELS: Record<string, [string, string]> = {
  '30d': ['30 วันล่าสุด', 'Last 30 days'],
  '14d': ['14 วันล่าสุด', 'Last 14 days'],
  '7d': ['7 วันล่าสุด', 'Last 7 days'],
  '3d': ['3 วันล่าสุด', 'Last 3 days'],
  '24h': ['24 ชั่วโมงล่าสุด', 'Last 24 hours'],
  '12h': ['12 ชั่วโมงล่าสุด', 'Last 12 hours'],
  '6h': ['6 ชั่วโมงล่าสุด', 'Last 6 hours'],
  '3h': ['3 ชั่วโมงล่าสุด', 'Last 3 hours'],
};

/**
 * The label for a window, in the reader's language. Falls back to whatever the
 * server sent for a custom range, which is a formatted date pair either way.
 */
export function windowLabel(key: string, serverLabel: string, locale: 'th' | 'en'): string {
  const pair = WINDOW_LABELS[key];
  return pair ? pair[locale === 'en' ? 1 : 0] : serverLabel;
}

/** Short form for the picker chips: drops the leading "Last"/trailing "ล่าสุด". */
export function windowChip(key: string, serverLabel: string, locale: 'th' | 'en'): string {
  return windowLabel(key, serverLabel, locale).replace('ล่าสุด', '').replace('Last ', '').trim();
}

/** Band label by key, so a range bar re-labels itself on a language switch. */
export function bandLabel(key: string, serverLabel: string, locale: 'th' | 'en'): string {
  const b = BANDS.find((x) => x.key === key);
  return b ? pick(b as unknown as Record<string, unknown>, 'label', locale) : serverLabel;
}
