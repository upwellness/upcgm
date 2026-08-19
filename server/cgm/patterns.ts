import type { MealMarker, MealResponse, Reading } from '@/lib/types';
import { tx, type Locale } from './i18n';
import { fmtDate, fmtThaiDate, fmtTime, fmtDuration } from '@/lib/time';
import { POST_MEAL_MINUTES, PRE_MEAL_MINUTES } from '@/lib/meal-response';
import { SOURCE_HOUSE } from './thresholds';

/**
 * The four shapes a post-meal curve can take, in the words the coaching deck
 * teaches: พุ่ง / กว้าง / ค้าง / ตก.
 *
 * These four words are OURS. They are a teaching device, not medical
 * terminology, and no published consensus classifies post-meal CGM curves this
 * way — so every threshold in this file is `house` and the UI has to say so.
 * The rule the deck sets and this file must honour: a real curve is usually a
 * mix, so we name the one that matters most and list the rest as secondary,
 * rather than pretending each meal is exactly one shape.
 *
 * Lives under server/ with the rest of the interpretation. The thresholds are
 * the part worth protecting; the client only ever receives the verdict.
 */

export type PatternKey = 'spike' | 'wide' | 'stuck' | 'crash' | 'flat';

export interface PatternDef {
  key: PatternKey;
  labelTh: string;
  en: string;
  /** one line a coach can say out loud */
  meaningTh: string;
  /** the first thing to try — behaviour only, never a dose */
  firstMoveTh: string;
}

export const patternDefs = (locale: Locale): Record<PatternKey, PatternDef> => {
  const t = tx(locale);
  return {
    spike: {
      key: 'spike', labelTh: t('พุ่ง', 'Spike'), en: 'Spike',
      meaningTh: t(
        'ขึ้นเร็ว ขึ้นสูง ยอดแหลม แล้วลงเร็ว',
        'Up fast, up high, a sharp peak, then down fast',
      ),
      firstMoveTh: t(
        'สลับลำดับ — กินผัก/โปรตีนก่อนคาร์บ แล้วเว้นสักครู่ก่อนแตะคาร์บ',
        'Change the order — vegetables and protein first, then wait a little before the carbs',
      ),
    },
    wide: {
      key: 'wide', labelTh: t('กว้าง', 'Wide'), en: 'Wide',
      meaningTh: t(
        'ยอดไม่สูงเท่าพุ่ง แต่ลากอยู่หลายชั่วโมง',
        'A lower peak than a spike, but it stays up for hours',
      ),
      firstMoveTh: t(
        'ลดปริมาณรวมของมื้อนั้น และจบมื้อให้เป็นเวลา ไม่กินยาว',
        'Make the meal smaller overall, and finish it at a set time instead of grazing',
      ),
    },
    stuck: {
      key: 'stuck', labelTh: t('ค้าง', 'Stuck'), en: 'Stuck',
      meaningTh: t(
        'ลงมาได้บ้าง แต่ค้างสูงกว่าก่อนกิน ไม่ถึงเส้นเดิม',
        'It comes down some, but settles above where it started and never returns to the line',
      ),
      firstMoveTh: t(
        'ขยับหลังมื้อ และเว้นระยะให้กราฟลงจริงก่อนมื้อถัดไป',
        'Move after the meal, and leave enough of a gap for the line to actually come down before the next one',
      ),
    },
    crash: {
      key: 'crash', labelTh: t('ตก', 'Crash'), en: 'Crash',
      meaningTh: t(
        'พุ่งแล้วดิ่งลงต่ำกว่าระดับก่อนกิน',
        'A spike, then a dive below where it started',
      ),
      firstMoveTh: t(
        'แก้ที่ยอดก่อน — ยอดเตี้ยลง หลุมมักตื้นลงตาม',
        'Fix the peak first — a lower peak usually means a shallower dip',
      ),
    },
    flat: {
      key: 'flat', labelTh: t('เรียบ', 'Flat'), en: 'Flat',
      meaningTh: t(
        'ขึ้นไม่มาก และกลับลงมาที่เดิมได้เอง',
        'It barely rises, and comes back to the line on its own',
      ),
      firstMoveTh: t(
        'มื้อแบบนี้คือมื้อที่ควรทำซ้ำ — จดไว้ว่ากินอะไร',
        'This is the meal to repeat — write down what it was',
      ),
    },
  };
};

/** @deprecated Thai-only snapshot; call patterns(locale) instead. */
export const PATTERNS: Record<PatternKey, PatternDef> = patternDefs('th');

/**
 * All house numbers, in one block so they can be read and argued with.
 * Chosen to match the shapes the deck draws, then sanity-checked against the
 * real files on hand; none of them come from a published target.
 */
export const PATTERN_RULES = {
  /** a rise this big is the one worth naming at all */
  spikeDelta: 60,
  /** ...and "พุ่ง" means it got there fast */
  spikeMinutesToPeak: 60,
  /** "กว้าง" is defined by time spent up, not by height */
  wideAboveBaseline: 30,
  wideMinutes: 150,
  /** still this far above the starting line at the 3-hour mark = ค้าง */
  stuckAt180Above: 25,
  /** dipping this far under the pre-meal line after the peak = ตก */
  crashBelowBaseline: 15,
  /** below this rise we call it เรียบ and stop talking */
  flatDelta: 30,
  /** fewer usable readings than this in the 3h window and we refuse to classify */
  minReadings: 12,
  sourceTh: SOURCE_HOUSE,
} as const;

export interface PatternHit {
  key: PatternKey;
  /** the number that fired the rule, for the UI to print next to the name */
  evidenceTh: string;
}

/**
 * Two very different reasons a meal gets no shape, and they must never be shown
 * as the same thing: 'thin-data' means we could not see, 'between-shapes' means
 * we saw clearly and it genuinely is not one of the four.
 */
export type NoShapeReason = 'thin-data' | 'between-shapes';

export interface MealPattern {
  markerId: string;
  /** null when the window is too thin to judge — never guess a shape */
  primary: PatternKey | null;
  /** other shapes the same curve also matches, strongest first */
  also: PatternKey[];
  hits: PatternHit[];
  /** set together with skippedReasonTh whenever primary is null */
  noShape: NoShapeReason | null;
  /** why we refused, when primary is null */
  skippedReasonTh: string | null;
  metrics: {
    delta: number | null;
    minutesToPeak: number | null;
    minutesAboveBaseline: number | null;
    at180Delta: number | null;
    nadirAfterPeakDelta: number | null;
  };
}

const usable = (r: Reading) => r.flag === 'ok' || r.flag === 'censored';

/**
 * Classify one meal. Order of the checks is the priority order the deck sets:
 * ตก first because it is the one with a safety consequence, then ค้าง because
 * it is a whole-week problem rather than a this-meal problem, then พุ่ง, then
 * กว้าง. Everything that matched is still reported in `also`.
 */
export function classifyMeal(markerT: number, response: MealResponse, all: Reading[], locale: Locale = 'th'): MealPattern {
  const t = tx(locale);
  const rs = all.filter(usable);
  const win = rs.filter((r) => r.t >= markerT && r.t <= markerT + POST_MEAL_MINUTES);
  const base = response.baseline;

  const empty: MealPattern['metrics'] = {
    delta: null, minutesToPeak: null, minutesAboveBaseline: null,
    at180Delta: null, nadirAfterPeakDelta: null,
  };

  if (base == null || response.delta == null || win.length < PATTERN_RULES.minReadings) {
    return {
      markerId: response.markerId, primary: null, also: [], hits: [],
      noShape: 'thin-data',
      skippedReasonTh: t(
        `ข้อมูลในช่วง 3 ชั่วโมงหลังมื้อนี้มีเพียง ${win.length} ค่า (ต้องมีอย่างน้อย ${PATTERN_RULES.minReadings}) — ยังไม่พอบอกรูปร่าง`,
        `Only ${win.length} readings in the 3 hours after this meal (at least ${PATTERN_RULES.minReadings} are needed) — not enough to call a shape.`,
      ),
      metrics: empty,
    };
  }

  // Minutes spent meaningfully above the pre-meal line. Counted as the gap
  // between consecutive readings rather than "readings x interval" so a gap in
  // the middle of the window cannot inflate it.
  let minutesAbove = 0;
  for (let i = 1; i < win.length; i++) {
    const dt = win[i].t - win[i - 1].t;
    if (dt <= 0 || dt > 30) continue; // a gap that long is not time we can claim
    const mid = (win[i].v + win[i - 1].v) / 2;
    if (mid >= base + PATTERN_RULES.wideAboveBaseline) minutesAbove += dt;
  }

  // Where it sat at the 3-hour mark, and how deep it went after the peak.
  const tail = win.filter((r) => r.t >= markerT + POST_MEAL_MINUTES - 20);
  const at180 = tail.length ? tail.reduce((a, r) => a + r.v, 0) / tail.length : null;
  const afterPeak = response.peakAt != null ? win.filter((r) => r.t > response.peakAt!) : [];
  const nadir = afterPeak.length ? Math.min(...afterPeak.map((r) => r.v)) : null;

  const metrics: MealPattern['metrics'] = {
    delta: response.delta,
    minutesToPeak: response.minutesToPeak,
    minutesAboveBaseline: Math.round(minutesAbove),
    at180Delta: at180 == null ? null : Math.round(at180 - base),
    nadirAfterPeakDelta: nadir == null ? null : Math.round(nadir - base),
  };

  const hits: PatternHit[] = [];

  if (metrics.nadirAfterPeakDelta != null && metrics.nadirAfterPeakDelta <= -PATTERN_RULES.crashBelowBaseline) {
    hits.push({
      key: 'crash',
      evidenceTh: t(
        `หลังยอดแล้วลงไปต่ำกว่าระดับก่อนกิน ${Math.abs(metrics.nadirAfterPeakDelta)} มก./ดล.`,
        `After the peak it dropped ${Math.abs(metrics.nadirAfterPeakDelta)} mg/dL below the pre-meal line`,
      ),
    });
  }
  if (metrics.at180Delta != null && metrics.at180Delta >= PATTERN_RULES.stuckAt180Above) {
    hits.push({
      key: 'stuck',
      evidenceTh: t(
        `ครบ 3 ชั่วโมงแล้วยังสูงกว่าก่อนกิน ${metrics.at180Delta} มก./ดล.`,
        `Still ${metrics.at180Delta} mg/dL above the pre-meal line at the 3-hour mark`,
      ),
    });
  }
  if (response.delta >= PATTERN_RULES.spikeDelta &&
      response.minutesToPeak != null && response.minutesToPeak <= PATTERN_RULES.spikeMinutesToPeak) {
    hits.push({
      key: 'spike',
      evidenceTh: t(
        `ขึ้น +${Math.round(response.delta)} มก./ดล. ภายใน ${response.minutesToPeak} นาที`,
        `Rose +${Math.round(response.delta)} mg/dL within ${response.minutesToPeak} minutes`,
      ),
    });
  }
  if (minutesAbove >= PATTERN_RULES.wideMinutes) {
    hits.push({
      key: 'wide',
      evidenceTh: t(
        `อยู่สูงกว่าระดับก่อนกินเกิน ${PATTERN_RULES.wideAboveBaseline} มก./ดล. นาน ${fmtDuration(minutesAbove)}`,
        `Stayed more than ${PATTERN_RULES.wideAboveBaseline} mg/dL above the pre-meal line for ${fmtDuration(minutesAbove)}`,
      ),
    });
  }

  if (hits.length === 0) {
    const flat = response.delta < PATTERN_RULES.flatDelta;
    return {
      markerId: response.markerId,
      primary: flat ? 'flat' : null,
      also: [],
      hits: flat
        ? [{ key: 'flat', evidenceTh: t(
            `ขึ้นเพียง +${Math.round(response.delta)} มก./ดล. และกลับลงมาที่เดิม`,
            `Rose only +${Math.round(response.delta)} mg/dL and came back to the line`,
          ) }]
        : [],
      noShape: flat ? null : 'between-shapes',
      skippedReasonTh: flat
        ? null
        : t(
            `ขึ้น +${Math.round(response.delta)} มก./ดล. แต่ไม่เข้าเกณฑ์รูปร่างใดชัดเจน — อยู่กลาง ๆ ระหว่างแบบ`,
            `Rose +${Math.round(response.delta)} mg/dL but does not clearly meet any shape — it sits between them`,
          ),
      metrics,
    };
  }

  // hits are already pushed in priority order
  return {
    markerId: response.markerId,
    primary: hits[0].key,
    also: hits.slice(1).map((h) => h.key),
    hits,
    noShape: null,
    skippedReasonTh: null,
    metrics,
  };
}

export interface PatternSnapshot {
  /** meals we could actually judge */
  judged: number;
  /** meals we could not see well enough to judge */
  thinData: number;
  /** meals seen clearly that are genuinely none of the four shapes */
  betweenShapes: number;
  counts: Record<PatternKey, number>;
  /** the shape to work on first, or null when nothing stands out */
  dominant: PatternKey | null;
  /** short line naming the dominant shape and how often it showed up */
  headlineTh: string;
  /** ordered lines a coach reads out — one per shape that appeared */
  linesTh: string[];
  /** the single next experiment, tied to the dominant shape */
  firstMoveTh: string | null;
  /** meals worth pointing at on the chart, worst first */
  examples: { markerId: string; labelTh: string; whenTh: string; patternTh: string; evidenceTh: string }[];
  /** true when a low after a meal showed up and meds make it a doctor's call */
  crashNeedsPrescriber: boolean;
}

/**
 * Roll the per-meal verdicts into the one paragraph a coach opens the session
 * with. Deliberately refuses to name a dominant shape off one or two meals: a
 * single ข้าวมันไก่ is an anecdote, not a pattern.
 */
export const MIN_MEALS_FOR_DOMINANT = 3;

export function summarisePatterns(
  patterns: MealPattern[],
  markers: MealMarker[],
  opts: { medsLowering: boolean },
  locale: Locale = 'th',
): PatternSnapshot {
  const t = tx(locale);
  const P = patternDefs(locale);
  const counts: Record<PatternKey, number> = { spike: 0, wide: 0, stuck: 0, crash: 0, flat: 0 };
  let judged = 0, thinData = 0, betweenShapes = 0;

  for (const p of patterns) {
    if (p.primary == null) {
      if (p.noShape === 'thin-data') thinData++; else betweenShapes++;
      continue;
    }
    judged++;
    counts[p.primary]++;
  }

  // "Dominant" means the most common non-flat shape. A run of flat meals is a
  // good result, not a problem to fix, so it never becomes the thing to work on.
  const ranked = (['crash', 'stuck', 'spike', 'wide'] as PatternKey[])
    .filter((k) => counts[k] > 0)
    .sort((a, b) => counts[b] - counts[a]);
  const dominant = judged >= MIN_MEALS_FOR_DOMINANT && ranked.length > 0 ? ranked[0] : null;

  const byId = new Map(markers.map((m) => [m.id, m]));
  const examples = patterns
    .filter((p) => p.primary != null && p.primary !== 'flat')
    .sort((a, b) => {
      const rank = (k: PatternKey | null) => (['crash', 'stuck', 'spike', 'wide'] as PatternKey[]).indexOf(k as PatternKey);
      const d = rank(a.primary) - rank(b.primary);
      return d !== 0 ? d : (b.metrics.delta ?? 0) - (a.metrics.delta ?? 0);
    })
    .slice(0, 4)
    .map((p) => {
      const mk = byId.get(p.markerId);
      return {
        markerId: p.markerId,
        labelTh: mk?.label ?? t('มื้อที่บันทึกไว้', 'Logged meal'),
        whenTh: mk ? `${fmtDate(mk.t, locale)} ${fmtTime(mk.t)}` : '',
        patternTh: P[p.primary!].labelTh,
        evidenceTh: p.hits[0]?.evidenceTh ?? '',
      };
    });

  const linesTh: string[] = [];
  for (const k of ['crash', 'stuck', 'spike', 'wide', 'flat'] as PatternKey[]) {
    if (counts[k] === 0) continue;
    linesTh.push(t(`${P[k].labelTh} ${counts[k]} มื้อ — ${P[k].meaningTh}`, `${P[k].labelTh} — ${counts[k]} ${counts[k] === 1 ? 'meal' : 'meals'} — ${P[k].meaningTh}`));
  }

  let headlineTh: string;
  if (judged === 0) {
    headlineTh = t(
      'ยังไม่มีมื้อที่ข้อมูลพอจะบอกรูปร่างได้ — บันทึกมื้ออาหารเพิ่มอีกสักสองสามมื้อ',
      'No meal has enough data to call a shape yet — log a few more meals.',
    );
  } else if (dominant == null) {
    headlineTh = judged < MIN_MEALS_FOR_DOMINANT
      ? t(
          `มี ${judged} มื้อที่อ่านรูปร่างได้ — ยังน้อยเกินกว่าจะบอกว่าเป็นแพตเทิร์นประจำ (ขออย่างน้อย ${MIN_MEALS_FOR_DOMINANT} มื้อ)`,
          `${judged} ${judged === 1 ? 'meal reads' : 'meals read'} clearly — still too few to call it a habit (at least ${MIN_MEALS_FOR_DOMINANT} are needed).`,
        )
      : t(
          `${judged} มื้อที่อ่านได้ ส่วนใหญ่กลับลงมาที่เดิมได้เอง — ยังไม่มีรูปร่างไหนที่ต้องแก้เป็นพิเศษ`,
          `${judged} meals read clearly and most came back to the line on their own — no one shape stands out as needing work.`,
        );
  } else {
    headlineTh = t(
      `รูปร่างที่เจอบ่อยที่สุดคือ “${P[dominant].labelTh}” (${counts[dominant]} จาก ${judged} มื้อที่อ่านได้) — ${P[dominant].meaningTh}`,
      `The shape that comes up most is “${P[dominant].labelTh}” (${counts[dominant]} of ${judged} meals read) — ${P[dominant].meaningTh}`,
    );
  }

  const crashNeedsPrescriber = counts.crash > 0 && opts.medsLowering;

  return {
    judged, thinData, betweenShapes, counts, dominant, headlineTh, linesTh,
    firstMoveTh: dominant ? P[dominant].firstMoveTh : null,
    examples,
    crashNeedsPrescriber,
  };
}

/** Convenience for callers that hold markers + responses and want both steps. */
export function analysePatterns(
  markers: MealMarker[],
  responses: MealResponse[],
  readings: Reading[],
  opts: { medsLowering: boolean },
  locale: Locale = 'th',
): { perMeal: MealPattern[]; snapshot: PatternSnapshot } {
  const byId = new Map(markers.map((m) => [m.id, m]));
  const perMeal = responses
    .filter((r) => byId.has(r.markerId))
    .map((r) => classifyMeal(byId.get(r.markerId)!.t, r, readings, locale));
  return { perMeal, snapshot: summarisePatterns(perMeal, markers, opts, locale) };
}

/** Documented so the UI can print the rule next to the verdict. */
export const patternRuleNote = (locale: Locale): string =>
  tx(locale)(
    `คำว่า พุ่ง · กว้าง · ค้าง · ตก เป็นคำที่ทีม UP Wellness ตั้งขึ้นเองเพื่อสอนให้จำง่าย ไม่ใช่ศัพท์ทางการแพทย์ ` +
      `และยังไม่มีมาตรฐานสากลที่จัดกลุ่มรูปกราฟหลังอาหารแบบนี้ · เกณฑ์ที่ใช้: ` +
      `พุ่ง = ขึ้น ≥ ${PATTERN_RULES.spikeDelta} มก./ดล. ภายใน ${PATTERN_RULES.spikeMinutesToPeak} นาที · ` +
      `กว้าง = อยู่สูงกว่าก่อนกินเกิน ${PATTERN_RULES.wideAboveBaseline} มก./ดล. นานกว่า ${PATTERN_RULES.wideMinutes} นาที · ` +
      `ค้าง = ครบ 3 ชม. ยังสูงกว่าก่อนกิน ≥ ${PATTERN_RULES.stuckAt180Above} มก./ดล. · ` +
      `ตก = หลังยอดลงต่ำกว่าก่อนกิน ≥ ${PATTERN_RULES.crashBelowBaseline} มก./ดล. · ` +
      `ระดับก่อนกินคิดจากค่าเฉลี่ย ${PRE_MEAL_MINUTES} นาทีก่อนมื้อ`,
    `Spike · Wide · Stuck · Crash are names the UP Wellness team coined to make the shapes easy to remember. ` +
      `They are not medical terms, and no international standard groups post-meal curves this way. The rules used: ` +
      `Spike = a rise of ${PATTERN_RULES.spikeDelta} mg/dL or more within ${PATTERN_RULES.spikeMinutesToPeak} minutes · ` +
      `Wide = more than ${PATTERN_RULES.wideAboveBaseline} mg/dL above the pre-meal line for longer than ${PATTERN_RULES.wideMinutes} minutes · ` +
      `Stuck = still ${PATTERN_RULES.stuckAt180Above} mg/dL or more above the pre-meal line at the 3-hour mark · ` +
      `Crash = drops ${PATTERN_RULES.crashBelowBaseline} mg/dL or more below the pre-meal line after the peak · ` +
      `The pre-meal line is the average of the ${PRE_MEAL_MINUTES} minutes before the meal.`,
  );

/** @deprecated Thai-only snapshot; call patternRuleNote(locale) instead. */
export const PATTERN_RULE_NOTE_TH = patternRuleNote('th');
