import type { AgpBin } from '@/lib/types';
import { minuteOfDay } from '@/lib/time';
import { AGP_BIN_MINUTES } from './metrics';
import { PATTERNS, type PatternKey } from './patterns';
import type { CgmEvent } from './excursions';

/**
 * Points to hang on the AGP so the picture answers "when" as well as "what".
 *
 * Rule-based on purpose. This is the layer a coach points at while talking, so
 * it has to be there on every wear, with or without an API key — the AI summary
 * is a separate, optional thing that can fail without taking this with it.
 *
 * Everything here is derived from numbers already on screen; nothing is
 * invented, and each note carries the count that produced it.
 */

export type AgpNoteKind = 'shape-cluster' | 'widest' | 'highest' | 'lowest' | 'overnight';

export interface AgpNote {
  /** minute-of-day of the bin this dot sits on */
  minute: number;
  /** where to draw it: the median line at that bin */
  atValue: number;
  kind: AgpNoteKind;
  /** shape this cluster is about, when the note is about one */
  pattern: PatternKey | null;
  titleTh: string;
  bodyTh: string;
  /** how strongly this deserves a dot; the UI keeps the top few */
  weight: number;
}

const hhmm = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const binLabel = (min: number) => `${hhmm(min)}–${hhmm((min + AGP_BIN_MINUTES) % 1440)}`;

/** At least this many events in one bin before it counts as a habit, not a day. */
export const MIN_CLUSTER = 2;
/** Dots beyond this just clutter the picture. */
export const MAX_NOTES = 6;

export function buildAgpNotes(bins: AgpBin[], events: CgmEvent[]): AgpNote[] {
  const usable = bins.filter((b) => b.p50 != null && !b.lowConfidence);
  if (usable.length < 8) return [];

  const notes: AgpNote[] = [];
  const medianAt = (minute: number) =>
    bins.find((b) => b.minute === minute)?.p50 ?? null;

  // ---- clusters of one shape at one time of day ----
  // The onset is what we bin on: "what time does this start" is the question a
  // coach can act on, and it is also the moment the client can point at a meal.
  const byBin = new Map<number, CgmEvent[]>();
  for (const e of events) {
    if (e.pattern.primary == null || e.pattern.primary === 'flat') continue;
    const b = Math.floor(minuteOfDay(e.t) / AGP_BIN_MINUTES) * AGP_BIN_MINUTES;
    byBin.set(b, [...(byBin.get(b) ?? []), e]);
  }

  for (const [minute, list] of byBin) {
    const tally = new Map<PatternKey, number>();
    for (const e of list) tally.set(e.pattern.primary!, (tally.get(e.pattern.primary!) ?? 0) + 1);
    const [topShape, count] = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (count < MIN_CLUSTER) continue;
    const v = medianAt(minute);
    if (v == null) continue;
    const d = PATTERNS[topShape];
    notes.push({
      minute,
      atValue: v,
      kind: 'shape-cluster',
      pattern: topShape,
      titleTh: `${binLabel(minute)} — เจอ “${d.labelTh}” ${count} ครั้ง`,
      bodyTh: `${d.meaningTh} · ช่วงเวลานี้ของวันคือจุดที่เกิดซ้ำมากที่สุด — ${d.firstMoveTh}`,
      weight: 100 + count * 10 + (topShape === 'crash' ? 5 : 0),
    });
  }

  // ---- the hour of the day that varies most between days ----
  const spreads = usable
    .filter((b) => b.p95 != null && b.p5 != null)
    .map((b) => ({ b, spread: (b.p95 as number) - (b.p5 as number) }))
    .sort((x, y) => y.spread - x.spread);
  if (spreads.length > 0 && spreads[0].spread >= 40) {
    const { b, spread } = spreads[0];
    notes.push({
      minute: b.minute,
      atValue: b.p50 as number,
      kind: 'widest',
      pattern: null,
      titleTh: `${binLabel(b.minute)} — ช่วงที่แต่ละวันต่างกันมากที่สุด`,
      bodyTh: `ห่างกัน ${Math.round(spread)} มก./ดล. ระหว่างวันที่สูงสุดกับต่ำสุด · แปลว่าช่วงนี้ยังไม่เป็นกิจวัตร — สิ่งที่ทำตอนนี้ของแต่ละวันไม่เหมือนกัน`,
      weight: 60,
    });
  }

  // ---- highest and lowest points of a typical day ----
  const byMedian = [...usable].sort((a, b) => (b.p50 as number) - (a.p50 as number));
  const hi = byMedian[0], lo = byMedian[byMedian.length - 1];
  if (hi && lo && (hi.p50 as number) - (lo.p50 as number) >= 20) {
    notes.push({
      minute: hi.minute,
      atValue: hi.p50 as number,
      kind: 'highest',
      pattern: null,
      titleTh: `${binLabel(hi.minute)} — จุดสูงสุดของวันปกติ`,
      bodyTh: `ค่ากลางอยู่ที่ ${Math.round(hi.p50 as number)} มก./ดล. · ถ้าจะแก้ทีละอย่าง เริ่มจากสิ่งที่เกิดก่อนเวลานี้`,
      weight: 55,
    });
    notes.push({
      minute: lo.minute,
      atValue: lo.p50 as number,
      kind: 'lowest',
      pattern: null,
      titleTh: `${binLabel(lo.minute)} — จุดต่ำสุดของวันปกติ`,
      bodyTh: `ค่ากลางอยู่ที่ ${Math.round(lo.p50 as number)} มก./ดล.`,
      weight: 40,
    });
  }

  // ---- overnight rises, which are the ones nobody is awake to explain ----
  const overnight = events.filter((e) => e.overnight && e.pattern.primary && e.pattern.primary !== 'flat');
  if (overnight.length >= MIN_CLUSTER) {
    const mid = overnight
      .map((e) => Math.floor(minuteOfDay(e.t) / AGP_BIN_MINUTES) * AGP_BIN_MINUTES)
      .sort((a, b) => a - b)[Math.floor(overnight.length / 2)];
    const v = medianAt(mid);
    if (v != null && !notes.some((n) => n.minute === mid)) {
      notes.push({
        minute: mid,
        atValue: v,
        kind: 'overnight',
        pattern: null,
        titleTh: `กลางคืน — น้ำตาลขึ้นเอง ${overnight.length} ครั้ง`,
        bodyTh: 'ช่วง 00:00–06:00 ส่วนใหญ่ไม่ได้มาจากอาหาร · น้ำตาลขึ้นเองตอนเช้ามืดได้ ถ้าเกิดซ้ำทุกคืนเป็นเรื่องที่ควรให้แพทย์ดู ไม่ใช่เรื่องที่ปรับด้วยเมนู',
        weight: 80,
      });
    }
  }

  // One dot per bin, strongest note wins, then keep the most useful few.
  const best = new Map<number, AgpNote>();
  for (const n of notes.sort((a, b) => b.weight - a.weight)) {
    if (!best.has(n.minute)) best.set(n.minute, n);
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_NOTES)
    .sort((a, b) => a.minute - b.minute);
}
