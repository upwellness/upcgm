/**
 * Every number the UI can show has to declare where it came from. Anything we
 * chose ourselves says so, in Thai, on screen — a coach must never present our
 * house rule as an international standard.
 *
 * Lives under server/ on purpose: the bands and their provenance are the part
 * of this tool worth protecting, so nothing under app/ marked 'use client' may
 * import from here. (Not using the `server-only` guard because these functions
 * are unit-tested in plain Node, where that package throws.)
 */

export type Provenance = 'consensus' | 'house';

export interface Threshold {
  id: string;
  labelTh: string;
  /** null = open ended */
  lo: number | null;
  hi: number | null;
  provenance: Provenance;
  sourceTh: string;
}

export const SOURCE_ATTD =
  'ฉันทามติสากลเรื่อง Time in Range (Battelino et al., Diabetes Care 2019) ซึ่ง ADA Standards of Care รับมาใช้';
export const SOURCE_GMI = 'Bergenstal et al., Diabetes Care 2018';
export const SOURCE_HOUSE = 'เกณฑ์ที่ทีม UP Wellness กำหนดขึ้นเอง — ยังไม่ใช่มาตรฐานสากล';

/** Device reporting floor/ceiling for Ottai CGM. */
export const DEVICE_FLOOR = 36;
export const DEVICE_CEILING = 450;

/**
 * Physiological ceiling on 5-minute change. Measured across 45,914 consecutive
 * pairs in the real files on hand: p99.9 = 22 mg/dL. Anything past 25 in one
 * step did not come from a pancreas.
 */
export const MAX_ROC_PER_5MIN = 25;

/** Consensus interpretation needs this much data before the numbers mean much. */
export const MIN_DAYS_FOR_METRICS = 14;
export const MIN_CAPTURE_PCT = 70;

/** GMI on a handful of hours looks authoritative and means nothing. */
export const MIN_DAYS_FOR_GMI = 3;

export const RANGES: Threshold[] = [
  { id: 'tbr54', labelTh: 'ต่ำมาก (ต่ำกว่า 54)', lo: null, hi: 54, provenance: 'consensus', sourceTh: SOURCE_ATTD },
  { id: 'tbr70', labelTh: 'ต่ำ (54–69)', lo: 54, hi: 70, provenance: 'consensus', sourceTh: SOURCE_ATTD },
  { id: 'tir', labelTh: 'อยู่ในเป้าหมาย (70–180)', lo: 70, hi: 180, provenance: 'consensus', sourceTh: SOURCE_ATTD },
  { id: 'tar180', labelTh: 'สูง (181–250)', lo: 180, hi: 250, provenance: 'consensus', sourceTh: SOURCE_ATTD },
  { id: 'tar250', labelTh: 'สูงมาก (มากกว่า 250)', lo: 250, hi: null, provenance: 'consensus', sourceTh: SOURCE_ATTD },
];

/**
 * The tighter band. Shown next to TIR because for someone without diabetes the
 * 70–180 band comes out near 100% for almost everyone, which tells a coach
 * nothing. No consensus target exists for it, and the UI must say so.
 */
export const TIGHT_RANGE: Threshold = {
  id: 'titr',
  labelTh: 'ช่วงเหมาะสม (70–140)',
  lo: 70,
  hi: 140,
  provenance: 'house',
  sourceTh:
    'ช่วง 70–140 ใช้เป็นตัวเทียบกับตัวเองข้ามสัปดาห์ — ยังไม่มีเป้าหมายมาตรฐานสากลสำหรับผู้ที่ไม่ได้เป็นเบาหวาน',
};

/** Our own window. Overnight lows are the ones nobody feels. */
export const NIGHT_START_MIN = 0;
export const NIGHT_END_MIN = 6 * 60;
export const NIGHT_SOURCE = SOURCE_HOUSE;

export interface TargetSet {
  id: string;
  labelTh: string;
  tirMinPct: number;
  tbr70MaxPct: number;
  tbr54MaxPct: number;
  tar180MaxPct: number;
  tar250MaxPct: number;
  cvMaxPct: number;
  sourceTh: string;
}

/**
 * Targets exist only for people living with diabetes. We keep them so a coach
 * can hand a report to a doctor, and we never apply them as a pass/fail grade
 * to someone who has not been diagnosed.
 */
export const TARGETS_ADULT_DIABETES: TargetSet = {
  id: 'adult-diabetes',
  labelTh: 'ผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 1 หรือ 2',
  tirMinPct: 70,
  tbr70MaxPct: 4,
  tbr54MaxPct: 1,
  tar180MaxPct: 25,
  tar250MaxPct: 5,
  cvMaxPct: 36,
  sourceTh: SOURCE_ATTD,
};

export const TARGETS_OLDER_HIGH_RISK: TargetSet = {
  id: 'older-high-risk',
  labelTh: 'ผู้สูงอายุ หรือผู้มีความเสี่ยงสูง',
  tirMinPct: 50,
  tbr70MaxPct: 1,
  tbr54MaxPct: 0,
  tar180MaxPct: 50,
  tar250MaxPct: 10,
  cvMaxPct: 36,
  sourceTh: SOURCE_ATTD,
};

export const CV_STABLE_MAX = 36;

/**
 * Metric visibility by window length. Showing GMI for a 3-hour slice produces a
 * number that looks exactly like the real thing — that is the most dangerous
 * screen this app could draw, so the gate lives in one place.
 */
export interface MetricGate {
  showRangePercents: boolean;
  showCv: boolean;
  showGmi: boolean;
  showAgp: boolean;
  noteTh: string | null;
}

export function gateForWindow(days: number, capturePct: number): MetricGate {
  if (days < 0.5) {
    return {
      showRangePercents: false, showCv: false, showGmi: false, showAgp: false,
      noteTh: 'ช่วงเวลานี้สั้นเกินกว่าจะสรุปเป็นตัวชี้วัดได้ — ดูรูปกราฟและค่าสูงสุด/ต่ำสุดได้ แต่ยังคิด % เวลาไม่ได้',
    };
  }
  if (days < 3) {
    return {
      showRangePercents: true, showCv: false, showGmi: false, showAgp: false,
      noteTh: 'ช่วงเวลาสั้น — % เวลาที่แสดงเป็นของช่วงนี้เท่านั้น ยังไม่ใช่ภาพพฤติกรรมโดยรวม',
    };
  }
  if (days < MIN_DAYS_FOR_METRICS) {
    return {
      showRangePercents: true, showCv: true, showGmi: true, showAgp: days >= 7,
      noteTh: `มีข้อมูล ${days.toFixed(1)} วัน — มาตรฐานสากลแนะนำอย่างน้อย ${MIN_DAYS_FOR_METRICS} วัน ตัวเลขจึงอ่านเป็นแนวโน้มได้ แต่ยังไม่ควรใช้เทียบเกณฑ์แบบเป๊ะ ๆ`,
    };
  }
  if (capturePct < MIN_CAPTURE_PCT) {
    return {
      showRangePercents: true, showCv: true, showGmi: false, showAgp: true,
      noteTh: `ข้อมูลครบเพียง ${capturePct.toFixed(0)}% ของช่วงเวลา (มาตรฐานแนะนำไม่น้อยกว่า ${MIN_CAPTURE_PCT}%) — ตัวเลขอาจไม่แทนพฤติกรรมจริง`,
    };
  }
  return { showRangePercents: true, showCv: true, showGmi: true, showAgp: true, noteTh: null };
}
