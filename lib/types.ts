import type { Minutes } from './time';

/**
 * Why a reading is or isn't fit to compute with.
 *  ok        — normal reading
 *  censored  — at the device floor, flanked by genuinely low values: a real low
 *              the sensor could not report any lower. Counts toward TBR.
 *  artifact  — at the floor but physiologically impossible to have arrived there
 *              (or stuck there for hours). Excluded from the numbers, shown on
 *              the chart so nobody wonders where it went.
 *  suspect   — an isolated impossible jump, or a duplicate timestamp with a
 *              different value. Excluded, surfaced.
 */
export type Flag = 'ok' | 'censored' | 'artifact' | 'suspect';

export interface Reading {
  /** Wall-clock minutes (see lib/time.ts) */
  t: Minutes;
  /** mg/dL */
  v: number;
  flag: Flag;
}

export interface RejectedRow {
  row: number;
  reason: string;
}

export interface QcNote {
  kind: 'floor-artifact' | 'floor-censored' | 'spike' | 'duplicate';
  from: Minutes;
  to: Minutes;
  count: number;
  minutes: number;
  /** value entering the run, for the reader to judge for themselves */
  before: number | null;
  after: number | null;
}

export interface Gap {
  from: Minutes;
  to: Minutes;
  minutes: number;
}

export interface DataQuality {
  rowsRead: number;
  rowsUsed: number;
  rejected: RejectedRow[];
  duplicatesDropped: number;
  /** readings that exist but are excluded from the maths */
  excludedFromMetrics: number;
  gaps: Gap[];
  qcNotes: QcNote[];
  /** readings ÷ readings a perfect 5-min series would hold over the same span */
  capturePct: number;
  spanDays: number;
  intervalMinutes: number;
  unitDetected: 'mg/dL' | 'mmol/L';
  unitConverted: boolean;
  /** true when the span is long enough for the consensus metrics to mean much */
  meetsFourteenDays: boolean;
  meetsSeventyPercent: boolean;
}

export interface RangeBucket {
  key: string;
  labelTh: string;
  /** Consensus name for the band — TIR, TBR L1, TAR L2 … (see lib/bands.ts). */
  abbr: string;
  pct: number;
  minutesPerDay: number;
}

export interface Metrics {
  n: number;
  firstT: Minutes;
  lastT: Minutes;
  mean: number;
  /** sample standard deviation (n−1), the AGP convention */
  sd: number;
  cv: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  minAt: Minutes;
  maxAt: Minutes;
  gmi: number | null;
  /** the international target band */
  tir70_180: number;
  /** the tighter band we show alongside it — no consensus target exists */
  titr70_140: number;
  tbrUnder70: number;
  tbrUnder54: number;
  tar180to250: number;
  tarOver250: number;
  tarOver180: number;
  /** night window is our own definition, labelled as such in the UI */
  nightTbrUnder70: number | null;
  nightMean: number | null;
  buckets: RangeBucket[];
}

export interface AgpBin {
  minute: number;
  n: number;
  lowConfidence: boolean;
  p5: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
}

export interface DailyProfile {
  dayStart: Minutes;
  n: number;
  capturePct: number;
  partial: boolean;
  mean: number;
  tir70_180: number;
  tbrUnder70: number;
  tarOver180: number;
  hasVeryLow: boolean;
}

export interface LowEvent {
  from: Minutes;
  to: Minutes;
  minutes: number;
  nadir: number;
  /** how many readings sat below the threshold — 1 means a single dip */
  count: number;
  level: 'level1' | 'level2';
  overnight: boolean;
  /** entry slope, mg/dL per 5 min — steep entries point at compression */
  entryDrop: number | null;
  suspectedCompression: boolean;
}

export interface Dataset {
  datasetId: string;
  sourceName: string;
  readings: Reading[];
  quality: DataQuality;
}

export interface AnalysisResult {
  datasetId: string;
  sourceName: string;
  quality: DataQuality;
  /** compact series for the wire: parallel arrays beat 3,000 objects */
  series: { t: number[]; v: number[]; flag: Flag[] };
  metrics: Metrics;
  agp: AgpBin[];
  daily: DailyProfile[];
  lowEvents: LowEvent[];
  /** per-range summaries, computed server-side (see server/cgm/window.ts) */
  windows: WindowSummaryWire[];
}

/** Structural mirror of server/cgm/window.ts WindowSummary, safe for the client. */
export interface WindowSummaryWire {
  key: string;
  labelTh: string;
  from: Minutes;
  to: Minutes;
  days: number;
  n: number;
  capturePct: number;
  metrics: Metrics | null;
  agp: AgpBin[];
  daily: DailyProfile[];
  lowEvents: LowEvent[];
  gate: { showRangePercents: boolean; showCv: boolean; showGmi: boolean; showAgp: boolean; noteTh: string | null };
  truncated: boolean;
}

/** Answer to the one safety question asked before results are shown. */
export type GlucoseLoweringMeds = 'yes' | 'no' | 'unknown';

export interface MealMarker {
  id: string;
  t: Minutes;
  label: string;
  kind: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink';
  /** vegetables/protein before carbs — the free experiment a coach can set */
  eatingOrder?: 'veg-first' | 'carb-first' | 'unknown';
  walkedAfter?: boolean;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** Glucose at a fixed offset after a meal — the checkpoints a coach is asked about. */
export interface MealCheckpoint {
  /** minutes after the meal marker: 60, 120, or 180 */
  minutes: number;
  value: number | null;
  /** value − baseline; null together with value when no reading falls near this offset */
  delta: number | null;
  readingsUsed: number;
}

export interface MealResponse {
  markerId: string;
  baseline: number | null;
  peak: number | null;
  peakAt: Minutes | null;
  delta: number | null;
  minutesToPeak: number | null;
  /** the number a coach can move even when weight will not budge */
  minutesToBaseline: number | null;
  readingsUsed: number;
  checkpoints: MealCheckpoint[];
}
