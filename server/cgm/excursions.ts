import type { MealMarker, Reading } from '@/lib/types';
import { tx, type Locale } from './i18n';
import type { Minutes } from '@/lib/time';
import { fmtDate, fmtTime, minuteOfDay } from '@/lib/time';
import { mealResponse, POST_MEAL_MINUTES } from '@/lib/meal-response';
import { NIGHT_END_MIN, NIGHT_START_MIN } from './thresholds';
import { patternDefs, classifyMeal, type MealPattern, type PatternKey } from './patterns';

/**
 * Finds every rise in the whole wear, not just the ones a coach remembered to
 * mark. A coach marks three meals a week; the sensor recorded twenty-one. The
 * shapes worth teaching are in the ones nobody wrote down.
 *
 * Classification is NOT re-implemented here — each detected rise is handed to
 * classifyMeal() in patterns.ts. One definition of the four shapes, so the badge
 * on a marked meal and the badge on a detected one can never disagree. (An older
 * app in this stack shipped three different definitions of time-in-range for
 * exactly the want-of-this reason.)
 *
 * Important honesty constraint: a detected rise is NOT known to be food. Glucose
 * climbs on its own before dawn, during illness, under stress, and after hard
 * exercise. Everything here says "ช่วงที่น้ำตาลขึ้น", never "มื้ออาหาร", unless a
 * marker the coach entered says otherwise.
 */

export const DETECT_RULES = {
  /** below this the rise is indistinguishable from sensor noise */
  minRise: 30,
  /** two onsets closer than this are the same event seen twice */
  minSeparation: 120,
  /** a reading is a peak only if nothing within this beats it */
  peakWindow: 20,
  /** how far back from a peak we look for the foot it climbed from */
  footSearch: 150,
  /** still "on the floor" while within this share of the climb above the low */
  floorFraction: 0.12,
  /** a marker this close to a detected onset is the same event */
  markerMatch: 45,
} as const;

export type EventSource = 'marked' | 'detected';

export interface CgmEvent {
  /** stable across re-renders and re-uploads: derived from the onset minute */
  id: string;
  t: Minutes;
  source: EventSource;
  pattern: MealPattern;
  /** the coach's label, when this event lines up with a marker they entered */
  markerId: string | null;
  labelTh: string | null;
  /** onset sits in 00:00–06:00, where a rise most likely is not food */
  overnight: boolean;
  whenTh: string;
  /** window the focus chart should draw */
  fromT: Minutes;
  toT: Minutes;
}

const usable = (r: Reading) => r.flag === 'ok' || r.flag === 'censored';

/**
 * Onsets of every rise big enough to be worth a look. Returns onset times only;
 * the caller classifies them.
 */
export function findOnsets(all: Reading[]): Minutes[] {
  const rs = all.filter(usable);
  if (rs.length < 12) return [];

  const candidates: { t: Minutes; rise: number }[] = [];

  // Peak first, then walk back to the foot it climbed from.
  //
  // The obvious way round — scan for feet, then look ahead for a peak — breaks
  // on the flattest, most common data there is: on a long steady stretch every
  // reading ties for "lowest nearby", so the first one wins and the onset lands
  // hours before the meal. That mislabels the curve as well as misplacing it,
  // because "still high three hours later" is then measured from the wrong zero.
  for (let i = 0; i < rs.length; i++) {
    let isPeak = true;
    for (let j = i - 1; j >= 0 && rs[j].t >= rs[i].t - DETECT_RULES.peakWindow; j--) {
      if (rs[j].v >= rs[i].v) { isPeak = false; break; }
    }
    if (isPeak) {
      for (let j = i + 1; j < rs.length && rs[j].t <= rs[i].t + DETECT_RULES.peakWindow; j++) {
        if (rs[j].v > rs[i].v) { isPeak = false; break; }
      }
    }
    if (!isPeak) continue;

    // Two passes, because one is not enough.
    //
    // Pass 1 finds the lowest point in the run-up, which gives the size of the
    // climb but NOT where it started: on a long flat approach the minimum is
    // just the deepest wobble in the noise, often an hour or more before the
    // curve actually leaves the floor.
    let footIdx = i;
    let footV = rs[i].v;
    for (let j = i - 1; j >= 0 && rs[j].t >= rs[i].t - DETECT_RULES.footSearch; j--) {
      if (rs[j].v < footV) { footV = rs[j].v; footIdx = j; }
    }
    const rise = rs[i].v - footV;
    if (rise < DETECT_RULES.minRise) continue;

    // Pass 2 walks forward from that minimum and keeps going while the curve is
    // still down on the floor, so the onset ends up at the last quiet reading
    // before the climb. Getting this wrong is not cosmetic: start the clock an
    // hour early and the three-hour mark lands mid-climb, which reads as "never
    // came back down" and labels an ordinary meal ค้าง.
    const floor = footV + Math.max(5, rise * DETECT_RULES.floorFraction);
    let onsetIdx = footIdx;
    for (let j = footIdx + 1; j < i; j++) {
      if (rs[j].v <= floor) onsetIdx = j; else break;
    }
    candidates.push({ t: rs[onsetIdx].t, rise });
  }

  // Non-maximum suppression: one climb produces a run of near-identical feet,
  // and reporting a meal twelve times is worse than not reporting it.
  candidates.sort((a, b) => b.rise - a.rise);
  const kept: Minutes[] = [];
  for (const c of candidates) {
    if (kept.every((k) => Math.abs(k - c.t) >= DETECT_RULES.minSeparation)) kept.push(c.t);
  }
  return kept.sort((a, b) => a - b);
}

/**
 * Every event in the window: the coach's marked meals plus every rise we found
 * on our own, deduped. A marked meal always wins over a detection at the same
 * time — the coach knows what they ate, we are guessing from a curve.
 */
export function buildEvents(
  readings: Reading[],
  markers: MealMarker[],
  /** onsets past this are dropped — see the tail note in interpret.ts */
  onsetCutoff?: Minutes,
  locale: Locale = 'th',
): CgmEvent[] {
  const byTime = [...markers].sort((a, b) => a.t - b.t);
  const events: CgmEvent[] = [];
  const inWindow = (t: Minutes) => onsetCutoff == null || t <= onsetCutoff;

  const push = (t: Minutes, source: EventSource, marker: MealMarker | null) => {
    const id = marker ? marker.id : `ex-${t}`;
    const resp = mealResponse(id, t, readings);
    const pattern = classifyMeal(t, resp, readings, locale);
    const mod = minuteOfDay(t);
    events.push({
      id,
      t,
      source,
      pattern,
      markerId: marker?.id ?? null,
      labelTh: marker?.label ?? null,
      overnight: mod >= NIGHT_START_MIN && mod < NIGHT_END_MIN,
      whenTh: `${fmtDate(t, locale)} ${fmtTime(t)}`,
      // 30 minutes of lead-in so the flat line before the rise is visible —
      // without it a coach cannot see what "back to where it started" means.
      fromT: t - 30,
      toT: t + POST_MEAL_MINUTES + 30,
    });
  };

  for (const m of byTime) push(m.t, 'marked', m);

  for (const t of findOnsets(readings)) {
    if (!inWindow(t)) continue; // starts in the tail we only kept for classifying
    const near = byTime.find((m) => Math.abs(m.t - t) <= DETECT_RULES.markerMatch);
    if (near) continue; // already represented by the coach's own marker
    push(t, 'detected', null);
  }

  return events.sort((a, b) => a.t - b.t);
}

export interface EventSnapshot {
  /** events we could put a shape on */
  judged: number;
  thinData: number;
  betweenShapes: number;
  /** how many came from the coach vs found by the scan */
  marked: number;
  detected: number;
  counts: Record<PatternKey, number>;
  dominant: PatternKey | null;
  headlineTh: string;
  firstMoveTh: string | null;
  /** rises that landed between midnight and 6am, which are the least likely to be food */
  overnightCount: number;
  crashNeedsPrescriber: boolean;
}

/** At least this many readable events before we call anything a habit. */
export const MIN_EVENTS_FOR_DOMINANT = 3;

export function summariseEvents(
  events: CgmEvent[],
  opts: { medsLowering: boolean },
  locale: Locale = 'th',
): EventSnapshot {
  const t = tx(locale);
  const PATTERNS = patternDefs(locale);
  const counts: Record<PatternKey, number> = { spike: 0, wide: 0, stuck: 0, crash: 0, flat: 0 };
  let judged = 0, thinData = 0, betweenShapes = 0, marked = 0, detected = 0, overnightCount = 0;

  for (const e of events) {
    if (e.source === 'marked') marked++; else detected++;
    if (e.overnight) overnightCount++;
    if (e.pattern.primary == null) {
      if (e.pattern.noShape === 'thin-data') thinData++; else betweenShapes++;
      continue;
    }
    judged++;
    counts[e.pattern.primary]++;
  }

  const ranked = (['crash', 'stuck', 'spike', 'wide'] as PatternKey[])
    .filter((k) => counts[k] > 0)
    .sort((a, b) => counts[b] - counts[a]);
  const dominant = judged >= MIN_EVENTS_FOR_DOMINANT && ranked.length > 0 ? ranked[0] : null;

  let headlineTh: string;
  if (judged === 0) {
    headlineTh = t(
      'ยังไม่เจอช่วงที่น้ำตาลขึ้นมากพอจะบอกรูปร่างได้ในช่วงเวลานี้',
      'No rise in this window is big enough to call a shape yet.',
    );
  } else if (dominant == null) {
    headlineTh = judged < MIN_EVENTS_FOR_DOMINANT
      ? t(
          `เจอ ${judged} ช่วงที่อ่านรูปร่างได้ — ยังน้อยเกินกว่าจะบอกว่าเป็นแพตเทิร์นประจำ`,
          `${judged} ${judged === 1 ? 'rise reads' : 'rises read'} clearly — still too few to call it a habit.`,
        )
      : t(
          `เจอ ${judged} ช่วงที่น้ำตาลขึ้น ส่วนใหญ่กลับลงมาที่เดิมได้เอง — ยังไม่มีรูปร่างไหนที่ต้องแก้เป็นพิเศษ`,
          `${judged} rises found, and most came back to the line on their own — no one shape stands out as needing work.`,
        );
  } else {
    headlineTh = t(
      `สแกนทั้งช่วงแล้วเจอ ${judged} ครั้งที่น้ำตาลขึ้น — รูปร่างที่เจอบ่อยที่สุดคือ “${PATTERNS[dominant].labelTh}” (${counts[dominant]} ครั้ง) ${PATTERNS[dominant].meaningTh}`,
      `Scanning the whole wear found ${judged} rises — the shape that comes up most is “${PATTERNS[dominant].labelTh}” (${counts[dominant]} of them). ${PATTERNS[dominant].meaningTh}`,
    );
  }

  return {
    judged, thinData, betweenShapes, marked, detected, counts, dominant,
    headlineTh,
    firstMoveTh: dominant ? PATTERNS[dominant].firstMoveTh : null,
    overnightCount,
    crashNeedsPrescriber: counts.crash > 0 && opts.medsLowering,
  };
}

/** Everything the screen needs, in one call. */
export function analyseEvents(
  readings: Reading[],
  markers: MealMarker[],
  opts: { medsLowering: boolean; onsetCutoff?: Minutes },
  locale: Locale = 'th',
): { events: CgmEvent[]; snapshot: EventSnapshot } {
  const events = buildEvents(readings, markers, opts.onsetCutoff, locale);
  return { events, snapshot: summariseEvents(events, opts, locale) };
}
