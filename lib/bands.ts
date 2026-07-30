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
  shortTh: string;
  lo: number | null;
  hi: number | null;
  fill: string;
  ink: string;
  /** the soft wash behind the chart */
  wash: string;
}

export const BANDS: Band[] = [
  { key: 'tbr54', labelTh: 'ต่ำมาก · ต่ำกว่า 54', shortTh: '<54', lo: null, hi: 54, fill: '#2F5D73', ink: '#2F5D73', wash: 'rgba(58,110,134,.16)' },
  { key: 'tbr70', labelTh: 'ต่ำ · 54–69', shortTh: '54–69', lo: 54, hi: 70, fill: '#3A6E86', ink: '#3A6E86', wash: 'rgba(58,110,134,.10)' },
  { key: 'tir', labelTh: 'อยู่ในเป้าหมาย · 70–180', shortTh: '70–180', lo: 70, hi: 180, fill: '#3E8E5A', ink: '#367C4F', wash: 'rgba(62,142,90,.09)' },
  { key: 'tar180', labelTh: 'สูง · 181–250', shortTh: '181–250', lo: 180, hi: 250, fill: '#C98A1E', ink: '#946516', wash: 'rgba(201,138,30,.11)' },
  { key: 'tar250', labelTh: 'สูงมาก · มากกว่า 250', shortTh: '>250', lo: 250, hi: null, fill: '#B4472F', ink: '#B4472F', wash: 'rgba(180,71,47,.13)' },
];

export const BAND_BY_KEY = Object.fromEntries(BANDS.map((b) => [b.key, b])) as Record<Band['key'], Band>;

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
  urgent: { dot: '#B4472F', chip: 'rgba(180,71,47,.12)', ink: '#B4472F', labelTh: 'ต้องคุยก่อน' },
  attention: { dot: '#C98A1E', chip: 'rgba(201,138,30,.13)', ink: '#946516', labelTh: 'ควรดู' },
  watch: { dot: '#3A6E86', chip: 'rgba(58,110,134,.12)', ink: '#3A6E86', labelTh: 'เฝ้าดู' },
  good: { dot: '#3E8E5A', chip: 'rgba(62,142,90,.12)', ink: '#367C4F', labelTh: 'ผ่านเกณฑ์' },
} as const;

/**
 * Colours and glyphs for the four shapes. Presentation only — the rules that
 * decide which shape a meal *is* live in server/cgm/patterns.ts and never reach
 * the browser. A tiny inline sketch of each curve rides along because the whole
 * teaching device is "look at the shape", and a coloured word is not a shape.
 */
export const PATTERN_STYLE = {
  spike: { labelTh: 'พุ่ง', en: 'Spike', ink: '#946516', chip: 'rgba(201,138,30,.14)',
    path: 'M2 20 L14 20 C18 20 19 3 24 3 C29 3 30 19 34 19 L58 19' },
  wide: { labelTh: 'กว้าง', en: 'Wide', ink: '#B08423', chip: 'rgba(201,138,30,.10)',
    path: 'M2 20 L12 20 C20 20 20 8 28 8 L38 8 C46 8 46 19 54 19 L58 19' },
  stuck: { labelTh: 'ค้าง', en: 'Stuck', ink: '#B4472F', chip: 'rgba(180,71,47,.12)',
    path: 'M2 20 L11 20 C17 20 16 4 23 4 C30 4 31 12 38 13 L58 13' },
  crash: { labelTh: 'ตก', en: 'Crash', ink: '#3A6E86', chip: 'rgba(58,110,134,.12)',
    path: 'M2 17 L12 17 C17 17 18 3 23 3 C28 3 29 25 36 25 C44 25 48 19 58 18' },
  flat: { labelTh: 'เรียบ', en: 'Flat', ink: '#367C4F', chip: 'rgba(62,142,90,.12)',
    path: 'M2 19 L16 19 C24 19 24 13 32 13 C40 13 42 19 50 19 L58 19' },
} as const;

export type PatternKey = keyof typeof PATTERN_STYLE;

export const MEAL_KINDS = [
  { key: 'breakfast', labelTh: 'มื้อเช้า', glyph: '🌅' },
  { key: 'lunch', labelTh: 'มื้อกลางวัน', glyph: '🍚' },
  { key: 'dinner', labelTh: 'มื้อเย็น', glyph: '🍽️' },
  { key: 'snack', labelTh: 'ของว่าง', glyph: '🍪' },
  { key: 'drink', labelTh: 'เครื่องดื่ม', glyph: '🥤' },
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
