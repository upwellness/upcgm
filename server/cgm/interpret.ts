import type { AnalysisResult, GlucoseLoweringMeds, MealMarker, MealResponse } from '@/lib/types';
import { tx, type Locale } from './i18n';
import { fmtDate, fmtDuration, fmtThaiDate, fmtTime, pctToMinutesPerDay } from '@/lib/time';
import { readingsFromWire } from '@/lib/meal-response';
import { DEVICE_FLOOR, TARGETS_ADULT_DIABETES, gateForWindow } from './thresholds';
import { patternDefs, analysePatterns, type MealPattern, type PatternSnapshot } from './patterns';
import { analyseEvents, type CgmEvent, type EventSnapshot } from './excursions';
import { buildAgpNotes, type AgpNote } from './agp-notes';

/**
 * Turning numbers into sentences is where a tool like this either earns trust or
 * loses it, so every sentence below is produced by a rule that can be read, and
 * every rule states which number triggered it. Nothing here is generated text.
 *
 * Two hard rules, both from the red-team pass:
 *  1. Nothing names a product, a dose, or a medicine. This tool reads a sensor.
 *  2. Anything that could be read as "your medication is too strong" is phrased
 *     as an observation plus "talk to the prescriber", never as an instruction.
 */

export type Severity = 'urgent' | 'attention' | 'watch' | 'good';

export interface Finding {
  id: string;
  severity: Severity;
  /** what the coach says out loud */
  titleTh: string;
  /** the number behind it, always shown so the claim is checkable */
  evidenceTh: string;
  /** what to do next — behaviour only, never a dose */
  actionTh: string | null;
  /** 'consensus' when a published target sets the line, 'house' when we did */
  basis: 'consensus' | 'house';
}

export interface Interpretation {
  headlineTh: string;
  /** ordered: the one thing to fix first is index 0 */
  findings: Finding[];
  /** shown verbatim on both the screen and the A4 sheet */
  limitationsTh: string[];
  /** true when the session must lead with "see the prescriber", not with advice */
  escalate: boolean;
  /** พุ่ง/กว้าง/ค้าง/ตก rollup over the meals the coach marked */
  patterns: PatternSnapshot | null;
  /** per-meal verdicts, so the meal list can show a badge next to each row */
  perMeal: MealPattern[];
  /** every rise in the window — marked meals plus ones the scan found itself */
  events: CgmEvent[];
  /** rollup over `events`; this is the one the screen leads with */
  eventSnapshot: EventSnapshot;
  /** dots to hang on the AGP, each with the sentence its tooltip shows */
  agpNotes: AgpNote[];
}

const pct = (n: number) => `${n.toFixed(1)}%`;

/**
 * Order of severity, then within a severity the order the rules fired. Lows
 * always sort above highs: a severe low can end a life this afternoon, a high
 * average shortens one over decades.
 */
const RANK: Record<Severity, number> = { urgent: 0, attention: 1, watch: 2, good: 3 };

export function interpret(
  result: AnalysisResult,
  opts: {
    meds: GlucoseLoweringMeds;
    markers?: MealMarker[];
    responses?: MealResponse[];
    locale?: Locale;
  },
): Interpretation {
  const locale = opts.locale ?? 'th';
  const t = tx(locale);
  const D = (x: number) => fmtDate(x, locale);
  const m = result.metrics;
  const q = result.quality;
  const gate = gateForWindow(q.spanDays, q.capturePct, locale);
  const findings: Finding[] = [];
  let escalate = false;

  // ---- lows first, always ----
  const realLows = result.lowEvents.filter((e) => !e.suspectedCompression);
  const severe = realLows.filter((e) => e.nadir < 54);

  if (gate.showRangePercents && m.tbrUnder54 > TARGETS_ADULT_DIABETES.tbr54MaxPct) {
    escalate = true;
    findings.push({
      id: 'tbr54',
      severity: 'urgent',
      titleTh: t('มีช่วงน้ำตาลต่ำระดับรุนแรง เกินเกณฑ์ที่ยอมรับได้', 'Severe lows exceed what is considered acceptable'),
      evidenceTh: t(
        `ต่ำกว่า 54 มก./ดล. ${pct(m.tbrUnder54)} ของเวลา (≈ ${fmtDuration(pctToMinutesPerDay(m.tbrUnder54), locale)}/วัน) — เกณฑ์สากลคือไม่เกิน ${TARGETS_ADULT_DIABETES.tbr54MaxPct}%`,
        `Below 54 mg/dL for ${pct(m.tbrUnder54)} of the time (about ${fmtDuration(pctToMinutesPerDay(m.tbrUnder54), locale)} a day) — the consensus limit is ${TARGETS_ADULT_DIABETES.tbr54MaxPct}%.`,
      ),
      actionTh:
        opts.meds === 'yes'
          ? t(
              'พาเคสไปคุยกับแพทย์ผู้สั่งยาก่อนปรับอะไรเรื่องอาหาร เพราะช่วงต่ำแบบนี้มักเกี่ยวกับขนาดยาหรือจังหวะการกินยา — เรื่องนี้อยู่นอกขอบเขตของโค้ช',
              'Take this to the prescribing doctor before changing anything about food. Lows like these usually track the dose or its timing, which is outside a coach\u2019s scope.',
            )
          : t(
              'บันทึกว่าช่วงต่ำเกิดตอนไหน ทำอะไรอยู่ กินอะไรมื้อก่อนหน้า แล้วให้เคสเล่าให้แพทย์ฟัง',
              'Write down when the lows happened, what they were doing, and what the meal before was — then have them tell their doctor.',
            ),
      basis: 'consensus',
    });
  }

  if (severe.length > 0 && !findings.some((f) => f.id === 'tbr54')) {
    escalate = true;
    const worst = severe.reduce((a, b) => (a.nadir <= b.nadir ? a : b));
    findings.push({
      id: 'severe-low-event',
      severity: 'urgent',
      titleTh: t(`พบช่วงน้ำตาลต่ำรุนแรง ${severe.length} ครั้ง`, `${severe.length} severe low ${severe.length === 1 ? 'episode' : 'episodes'}`),
      evidenceTh: t(
        `ต่ำสุดที่ ${worst.nadir} มก./ดล. · ${D(worst.from)} เวลา ${fmtTime(worst.from)} นาน ${fmtDuration(worst.minutes, locale)}`,
        `Lowest ${worst.nadir} mg/dL · ${D(worst.from)} at ${fmtTime(worst.from)}, lasting ${fmtDuration(worst.minutes, locale)}`,
      ),
      actionTh: t('ให้เคสเล่าอาการช่วงนั้นให้แพทย์ฟัง พร้อมเวลาที่เกิด', 'Have them describe how they felt at the time to their doctor, with the time it happened.'),
      basis: 'consensus',
    });
  }

  const overnight = realLows.filter((e) => e.overnight);
  if (overnight.length > 0) {
    findings.push({
      id: 'overnight-low',
      severity: severe.length > 0 ? 'attention' : 'watch',
      titleTh: t(`น้ำตาลต่ำตอนกลางคืน ${overnight.length} ครั้ง`, `${overnight.length} overnight ${overnight.length === 1 ? 'low' : 'lows'}`),
      evidenceTh: overnight
        .slice(0, 3)
        .map((e) => t(`${D(e.from)} ${fmtTime(e.from)} ต่ำสุด ${e.nadir}`, `${D(e.from)} ${fmtTime(e.from)}, low of ${e.nadir}`))
        .join(' · '),
      actionTh: t('ช่วงนี้คนไข้มักหลับอยู่และไม่รู้ตัว — คุ้มที่จะเล่าให้แพทย์ฟังแม้จะไม่มีอาการ', 'People are usually asleep through these and never feel them — worth telling the doctor even with no symptoms.'),
      // We call 00:00–06:00 "night". No consensus defines the window.
      basis: 'house',
    });
  }

  if (gate.showRangePercents && m.tbrUnder70 > TARGETS_ADULT_DIABETES.tbr70MaxPct && m.tbrUnder54 <= TARGETS_ADULT_DIABETES.tbr54MaxPct) {
    findings.push({
      id: 'tbr70',
      severity: 'attention',
      titleTh: t('เวลาที่น้ำตาลต่ำกว่า 70 มากกว่าเกณฑ์', 'Time below 70 is over the limit'),
      evidenceTh: t(
        `${pct(m.tbrUnder70)} ของเวลา (เกณฑ์ ≤ ${TARGETS_ADULT_DIABETES.tbr70MaxPct}%) ≈ ${fmtDuration(pctToMinutesPerDay(m.tbrUnder70), locale)}/วัน`,
        `${pct(m.tbrUnder70)} of the time (limit ${TARGETS_ADULT_DIABETES.tbr70MaxPct}%), about ${fmtDuration(pctToMinutesPerDay(m.tbrUnder70), locale)} a day`,
      ),
      actionTh: t('ดูว่าช่วงต่ำตรงกับหลังออกกำลังกาย หลังอดมื้อ หรือหลังกินยาไหม แล้วเล่าให้แพทย์ฟัง', 'Check whether the lows line up with exercise, a skipped meal, or medication timing — then tell the doctor.'),
      basis: 'consensus',
    });
  }

  // ---- then the bulk of the day ----
  if (gate.showRangePercents) {
    if (m.tir70_180 >= TARGETS_ADULT_DIABETES.tirMinPct) {
      findings.push({
        id: 'tir-good',
        severity: 'good',
        titleTh: t('เวลาที่อยู่ในช่วงเป้าหมายผ่านเกณฑ์', 'Time in target meets the goal'),
        evidenceTh: t(
          `อยู่ในช่วง 70–180 ${pct(m.tir70_180)} ของเวลา (เกณฑ์ ≥ ${TARGETS_ADULT_DIABETES.tirMinPct}%)`,
          `In the 70–180 range ${pct(m.tir70_180)} of the time (goal ${TARGETS_ADULT_DIABETES.tirMinPct}% or more)`,
        ),
        actionTh: null,
        basis: 'consensus',
      });
    } else {
      findings.push({
        id: 'tir-low',
        severity: m.tir70_180 < 50 ? 'urgent' : 'attention',
        titleTh: t('เวลาที่อยู่ในช่วงเป้าหมายยังน้อยกว่าเกณฑ์', 'Time in target is below the goal'),
        evidenceTh: t(
          `อยู่ในช่วง 70–180 ${pct(m.tir70_180)} (เกณฑ์ ≥ ${TARGETS_ADULT_DIABETES.tirMinPct}%) — ขาดอีก ${(TARGETS_ADULT_DIABETES.tirMinPct - m.tir70_180).toFixed(1)} จุด`,
          `In the 70–180 range ${pct(m.tir70_180)} (goal ${TARGETS_ADULT_DIABETES.tirMinPct}% or more) — ${(TARGETS_ADULT_DIABETES.tirMinPct - m.tir70_180).toFixed(1)} points short`,
        ),
        actionTh: t('เริ่มจากมื้อที่ทำให้ขึ้นสูงสุดก่อน 1 มื้อ ไม่ต้องแก้ทุกมื้อพร้อมกัน', 'Start with the one meal that drives the biggest rise. There is no need to change every meal at once.'),
        basis: 'consensus',
      });
    }

    if (m.tarOver250 > TARGETS_ADULT_DIABETES.tar250MaxPct) {
      findings.push({
        id: 'tar250',
        severity: 'attention',
        titleTh: t('มีช่วงน้ำตาลสูงมาก', 'There are stretches of very high glucose'),
        evidenceTh: t(
          `สูงกว่า 250 มก./ดล. ${pct(m.tarOver250)} ของเวลา (เกณฑ์ ≤ ${TARGETS_ADULT_DIABETES.tar250MaxPct}%) ≈ ${fmtDuration(pctToMinutesPerDay(m.tarOver250), locale)}/วัน`,
          `Above 250 mg/dL for ${pct(m.tarOver250)} of the time (limit ${TARGETS_ADULT_DIABETES.tar250MaxPct}%), about ${fmtDuration(pctToMinutesPerDay(m.tarOver250), locale)} a day`,
        ),
        actionTh: t('ดูว่าเกิดหลังมื้อไหนซ้ำ ๆ — ถ้าเกิดทุกวันในเวลาเดียวกัน มื้อนั้นคือจุดเริ่ม', 'Look for which meal it follows. If it happens at the same time every day, that meal is where to start.'),
        basis: 'consensus',
      });
    }
  }

  if (gate.showCv) {
    if (m.cv > TARGETS_ADULT_DIABETES.cvMaxPct) {
      findings.push({
        id: 'cv-high',
        severity: 'attention',
        titleTh: t('น้ำตาลแกว่งมากกว่าเกณฑ์', 'Glucose swings more than the limit'),
        evidenceTh: t(
          `ค่าความแปรปรวน (CV) ${pct(m.cv)} — เกณฑ์คือไม่เกิน ${TARGETS_ADULT_DIABETES.cvMaxPct}%`,
          `Coefficient of variation (CV) ${pct(m.cv)} — the limit is ${TARGETS_ADULT_DIABETES.cvMaxPct}%`,
        ),
        actionTh: t('ความแกว่งมักมาจากมื้อที่คาร์บเยอะและเร็ว มากกว่ามาจากปริมาณรวมทั้งวัน', 'Swing usually comes from meals heavy in fast carbohydrate rather than from the day\u2019s total.'),
        basis: 'consensus',
      });
    } else {
      findings.push({
        id: 'cv-ok',
        severity: 'good',
        titleTh: t('ความแกว่งของน้ำตาลอยู่ในเกณฑ์', 'Glucose variability is within the limit'),
        evidenceTh: t(`CV ${pct(m.cv)} (เกณฑ์ ≤ ${TARGETS_ADULT_DIABETES.cvMaxPct}%)`, `CV ${pct(m.cv)} (limit ${TARGETS_ADULT_DIABETES.cvMaxPct}%)`),
        actionTh: null,
        basis: 'consensus',
      });
    }
  }

  // ---- meals: the part a coach can actually change ----
  const paired = (opts.responses ?? [])
    .map((r) => ({ r, marker: (opts.markers ?? []).find((mk) => mk.id === r.markerId) }))
    .filter((p): p is { r: MealResponse; marker: MealMarker } => !!p.marker && p.r.delta != null);

  // ---- shape of each meal: พุ่ง / กว้าง / ค้าง / ตก ----
  // Runs off the full series, not the paired subset, because a marker with too
  // little data around it still deserves an honest "cannot tell" rather than
  // being silently dropped.
  // `series` is always the whole wear, while `metrics` has already been swapped
  // for the selected window's. Scanning the raw series would report rises from
  // days the coach is not looking at, against a headline computed from a week —
  // so the scan is clipped to the same window everything else on screen uses.
  // The tail is kept whole: an event that starts inside the window needs its
  // full three hours to be classified, even if they run past the edge.
  const readings = readingsFromWire(result.series)
    .filter((r) => r.t >= m.firstT && r.t <= m.lastT + 240);
  const { perMeal, snapshot } = analysePatterns(
    opts.markers ?? [],
    opts.responses ?? [],
    readings,
    { medsLowering: opts.meds === 'yes' },
    locale,
  );
  const patterns = (opts.markers ?? []).length > 0 ? snapshot : null;

  // The whole-window scan. Runs on every window so a coach who has marked
  // nothing still gets something to look at — which is the normal case.
  const { events, snapshot: eventSnapshot } = analyseEvents(
    readings, opts.markers ?? [],
    { medsLowering: opts.meds === 'yes', onsetCutoff: m.lastT },
    locale,
  );

  if (eventSnapshot.crashNeedsPrescriber) {
    // A post-meal low in someone on a glucose-lowering medicine is not a meal
    // to coach around. It goes back to whoever wrote the prescription.
    escalate = true;
    findings.push({
      id: 'pattern-crash-meds',
      severity: 'urgent',
      titleTh: t('เจอรูปแบบ “ตก” ในเคสที่ใช้ยาลดน้ำตาลอยู่', 'A “Crash” shape in someone taking glucose-lowering medication'),
      evidenceTh: t(
        `${eventSnapshot.counts.crash} ช่วงที่หลังยอดแล้วลงต่ำกว่าระดับก่อนขึ้นเกิน 15 มก./ดล.`,
        `${eventSnapshot.counts.crash} ${eventSnapshot.counts.crash === 1 ? 'rise' : 'rises'} where it fell more than 15 mg/dL below the starting line after the peak`,
      ),
      actionTh: t(
        'หยุดปรับอาหารเองก่อน แล้วส่งกราฟให้แพทย์ผู้สั่งยาดู — ช่วงต่ำในคนที่ใช้ยาอยู่เป็นเรื่องของขนาดยา ไม่ใช่เรื่องที่โค้ชแก้ด้วยเมนู',
        'Stop adjusting food and send the chart to the prescribing doctor. Lows in someone on medication are a dose question, not one a coach fixes with a menu.',
      ),
      basis: 'house',
    });
  }

  if (eventSnapshot.dominant) {
    const d = patternDefs(locale)[eventSnapshot.dominant];
    const worst = events
      .filter((e) => e.pattern.primary === eventSnapshot.dominant)
      .sort((a, b) => (b.pattern.metrics.delta ?? 0) - (a.pattern.metrics.delta ?? 0))[0];
    findings.push({
      id: `pattern-${eventSnapshot.dominant}`,
      severity: eventSnapshot.dominant === 'crash' ? 'attention' : 'watch',
      titleTh: t(`รูปร่างกราฟที่เจอบ่อยที่สุดคือ “${d.labelTh}” — ${d.meaningTh}`, `The most common shape is “${d.labelTh}” — ${d.meaningTh}`),
      evidenceTh:
        t(
          `${eventSnapshot.counts[eventSnapshot.dominant]} จาก ${eventSnapshot.judged} ช่วงที่น้ำตาลขึ้นและอ่านรูปร่างได้ (สแกนทั้งช่วงเวลาที่เลือก ไม่ใช่เฉพาะมื้อที่บันทึกไว้)`,
          `${eventSnapshot.counts[eventSnapshot.dominant]} of ${eventSnapshot.judged} readable rises (the whole selected window was scanned, not just the logged meals)`,
        ) +
        (worst
          ? t(
              ` · แรงที่สุดคือ ${worst.labelTh ? `“${worst.labelTh}” ` : ''}${worst.whenTh} — ${worst.pattern.hits[0]?.evidenceTh ?? ''}`,
              ` · The strongest was ${worst.labelTh ? `“${worst.labelTh}” ` : ''}${worst.whenTh} — ${worst.pattern.hits[0]?.evidenceTh ?? ''}`,
            )
          : ''),
      actionTh: t(
        `${d.firstMoveTh} — แก้ทีละแบบ แบบที่เด่นที่สุดก่อน แล้วอีก 2–3 วันมาเทียบกราฟกัน`,
        `${d.firstMoveTh} — change one shape at a time, the most common one first, then compare charts in two or three days.`,
      ),
      basis: 'house',
    });
  }

  if (paired.length > 0) {
    const worst = paired.reduce((a, b) => ((a.r.delta ?? 0) >= (b.r.delta ?? 0) ? a : b));
    findings.push({
      id: 'meal-peak',
      severity: (worst.r.delta ?? 0) > 60 ? 'attention' : 'watch',
      titleTh: t(
        `มื้อที่ดันน้ำตาลขึ้นมากที่สุดคือ “${worst.marker.label}” (${D(worst.marker.t)} ${fmtTime(worst.marker.t)})`,
        `The meal that pushed glucose highest was “${worst.marker.label}” (${D(worst.marker.t)} ${fmtTime(worst.marker.t)})`,
      ),
      evidenceTh:
        t(
          `ขึ้น +${Math.round(worst.r.delta ?? 0)} มก./ดล. จาก ${Math.round(worst.r.baseline ?? 0)} ไปสูงสุด ${Math.round(worst.r.peak ?? 0)} ใน ${worst.r.minutesToPeak} นาที`,
          `Rose +${Math.round(worst.r.delta ?? 0)} mg/dL, from ${Math.round(worst.r.baseline ?? 0)} to a peak of ${Math.round(worst.r.peak ?? 0)} in ${worst.r.minutesToPeak} minutes`,
        ) +
        (worst.r.minutesToBaseline != null
          ? t(
              ` และกลับลงมาที่เดิมใน ${fmtDuration(worst.r.minutesToBaseline, locale)}`,
              `, and came back to the line in ${fmtDuration(worst.r.minutesToBaseline, locale)}`,
            )
          : t(' (ยังไม่กลับลงมาที่เดิมในช่วง 3 ชั่วโมงที่ดู)', ' (it had not returned to the line within the 3 hours looked at)')),
      actionTh: t(
        'ลองมื้อเดิมแต่กินผัก/โปรตีนก่อนคาร์บ แล้วเดิน 10–15 นาทีหลังมื้อ อีก 2–3 วันมาเทียบกราฟกัน',
        'Try the same meal but with vegetables and protein before the carbohydrate, then a 10–15 minute walk afterwards. Compare charts in two or three days.',
      ),
      basis: 'house',
    });

    const slow = paired.filter((p) => p.r.minutesToBaseline == null || p.r.minutesToBaseline > 180);
    if (slow.length > 0 && slow.length === paired.length) {
      findings.push({
        id: 'slow-return',
        severity: 'watch',
        titleTh: t('น้ำตาลใช้เวลานานกว่าจะกลับลงมาที่เดิมหลังอาหาร', 'Glucose takes a long time to come back down after meals'),
        evidenceTh: t(
          `${slow.length} จาก ${paired.length} มื้อที่บันทึกไว้ ยังไม่กลับถึงระดับก่อนอาหารภายใน 3 ชั่วโมง`,
          `${slow.length} of ${paired.length} logged meals had not returned to the pre-meal level within 3 hours`,
        ),
        actionTh: t('ระยะเวลากลับลงมาที่เดิมมักขยับได้เร็วกว่าน้ำหนัก — ใช้เป็นตัวชี้ผลระยะสั้นได้ดี', 'Return-to-baseline time usually moves faster than weight does, which makes it a good short-term marker of progress.'),
        basis: 'house',
      });
    }
  }

  // ---- data quality is a finding, not a footnote ----
  if (!q.meetsFourteenDays || !q.meetsSeventyPercent) {
    findings.push({
      id: 'data-span',
      severity: 'watch',
      titleTh: t('ข้อมูลยังสั้นกว่าที่เกณฑ์สากลใช้ตัดสิน', 'The record is shorter than the consensus asks for'),
      evidenceTh: t(
        `มีข้อมูล ${q.spanDays.toFixed(1)} วัน · เก็บได้ ${q.capturePct.toFixed(0)}% ของเวลา — เกณฑ์คือ 14 วันและ 70%`,
        `${q.spanDays.toFixed(1)} days of data, covering ${q.capturePct.toFixed(0)}% of the time — the standard asks for 14 days and 70%.`,
      ),
      actionTh: t('อ่านเป็นแนวโน้มได้ แต่ยังไม่ควรใช้ตัวเลขนี้ไปเทียบเกณฑ์แบบเป๊ะ ๆ', 'Read it as a direction of travel, not as a score to hold against the targets.'),
      basis: 'consensus',
    });
  }

  const artifacts = q.qcNotes.filter((n) => n.kind === 'floor-artifact');
  if (artifacts.length > 0) {
    const minutes = artifacts.reduce((s, n) => s + n.minutes, 0);
    findings.push({
      id: 'sensor-artifact',
      severity: 'watch',
      titleTh: t('มีช่วงที่เซนเซอร์น่าจะหลุด/ถูกกดทับ', 'Stretches where the sensor was probably loose or compressed'),
      evidenceTh: t(
        `${artifacts.length} ช่วง รวม ${fmtDuration(minutes, locale)} ที่ค่าตกไปติดพื้นเครื่อง (${DEVICE_FLOOR} มก./ดล.) แบบที่ร่างกายลงเร็วขนาดนั้นไม่ได้ — ตัดออกจากการคำนวณแล้ว`,
        `${artifacts.length} stretches totalling ${fmtDuration(minutes, locale)} where the value sat on the device floor (${DEVICE_FLOOR} mg/dL) faster than a body can fall — excluded from the calculations.`,
      ),
      actionTh: t('ถ้าเกิดตอนกลางคืนซ้ำ ๆ มักเป็นการนอนทับ ลองเปลี่ยนข้างที่ติดเซนเซอร์', 'If it repeats overnight it is usually sleeping on the sensor — try wearing it on the other side.'),
      basis: 'house',
    });
  }

  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  const limitationsTh = [
    t(
      'เครื่อง CGM วัดน้ำตาลในน้ำระหว่างเซลล์ ไม่ใช่ในเลือดโดยตรง ค่าจะตามหลังเลือดจริงประมาณ 5–15 นาที',
      'A CGM measures glucose in interstitial fluid, not in blood directly, so it trails actual blood glucose by roughly 5–15 minutes.',
    ),
    t(
      'รายงานนี้อ่านจากไฟล์ที่ส่งเข้ามาเท่านั้น ไม่ใช่การวินิจฉัย และไม่ใช่คำสั่งปรับยา',
      'This report reads only the file that was uploaded. It is not a diagnosis and not an instruction to change any medication.',
    ),
  ];
  if (gate.noteTh) limitationsTh.unshift(gate.noteTh);
  if (opts.meds === 'unknown') {
    limitationsTh.push(t(
      'ยังไม่ได้ระบุว่าเคสใช้ยาลดน้ำตาลอยู่หรือไม่ — ข้อสรุปเรื่องช่วงน้ำตาลต่ำจึงตีความได้จำกัด',
      'It has not been recorded whether this person takes glucose-lowering medication, which limits how far the conclusions about lows can be read.',
    ));
  }

  if (eventSnapshot.judged > 0) {
    limitationsTh.push(
      t(
        'ชื่อรูปร่างกราฟ (พุ่ง · กว้าง · ค้าง · ตก) เป็นคำที่ทีมตั้งขึ้นเองเพื่อสอนให้จำง่าย ไม่ใช่ศัพท์ทางการแพทย์ และเกณฑ์ที่ใช้แบ่งก็เป็นเกณฑ์ของทีมเอง',
        'The shape names (Spike · Wide · Stuck · Crash) are ones this team coined to make them easy to remember. They are not medical terms, and the thresholds that separate them are ours too.',
      ),
    );
  }
  if (eventSnapshot.detected > 0) {
    // The single most important caveat on this screen. A rise found by the scan
    // is a rise, full stop — not a meal. Saying otherwise hands a coach a story
    // about food for something that may have been dawn, illness or a hard run.
    limitationsTh.push(
      t(
        `ช่วงที่น้ำตาลขึ้น ${eventSnapshot.detected} ครั้งมาจากการสแกนกราฟ ไม่ใช่มื้อที่ใครบันทึกไว้ — ยืนยันไม่ได้ว่ามาจากอาหาร น้ำตาลขึ้นเองได้ตอนเช้ามืด ตอนป่วย ตอนเครียด และหลังออกกำลังกายหนัก`,
        `${eventSnapshot.detected} of the rises came from scanning the curve, not from a meal anyone logged — there is no way to confirm food caused them. Glucose rises on its own before dawn, during illness, under stress, and after hard exercise.`,
      ) +
      (eventSnapshot.overnightCount > 0
        ? t(
            ` (ในจำนวนนี้ ${eventSnapshot.overnightCount} ครั้งเกิดช่วง 00:00–06:00 ซึ่งมักไม่ใช่มื้ออาหาร)`,
            ` (${eventSnapshot.overnightCount} of them fell between 00:00 and 06:00, which is usually not a meal.)`,
          )
        : ''),
    );
  }

  const headlineTh = buildHeadline(m, gate.showRangePercents, escalate, locale);
  const agpNotes = gate.showAgp ? buildAgpNotes(result.agp, events, locale) : [];

  return { headlineTh, findings, limitationsTh, escalate, patterns, perMeal, events, eventSnapshot, agpNotes };
}

function buildHeadline(
  m: AnalysisResult['metrics'],
  showPercents: boolean,
  escalate: boolean,
  locale: Locale = 'th',
): string {
  const t = tx(locale);
  if (escalate) {
    return t(
      'เรื่องที่ต้องคุยก่อนอย่างอื่น: มีช่วงน้ำตาลต่ำที่ต้องให้แพทย์ดู',
      'Before anything else: there are lows that need a doctor to look at them.',
    );
  }
  if (!showPercents) {
    return t(`ค่าเฉลี่ยในช่วงที่เลือก ${Math.round(m.mean)} มก./ดล.`, `Average over the selected window: ${Math.round(m.mean)} mg/dL`);
  }
  if (m.tir70_180 >= TARGETS_ADULT_DIABETES.tirMinPct && m.cv <= TARGETS_ADULT_DIABETES.cvMaxPct) {
    return t(
      `ภาพรวมดี — อยู่ในช่วงเป้าหมาย ${pct(m.tir70_180)} และแกว่งไม่มาก`,
      `A good picture overall — in target ${pct(m.tir70_180)} of the time, without much swing.`,
    );
  }
  if (m.tir70_180 >= TARGETS_ADULT_DIABETES.tirMinPct) {
    return t(
      `อยู่ในช่วงเป้าหมาย ${pct(m.tir70_180)} ผ่านเกณฑ์ แต่ยังแกว่งมาก (CV ${pct(m.cv)})`,
      `In target ${pct(m.tir70_180)} of the time, which meets the goal, but the swing is still wide (CV ${pct(m.cv)}).`,
    );
  }
  return t(
    `อยู่ในช่วงเป้าหมาย ${pct(m.tir70_180)} — เป้าหมายถัดไปคือ ${TARGETS_ADULT_DIABETES.tirMinPct}%`,
    `In target ${pct(m.tir70_180)} of the time — the next goal is ${TARGETS_ADULT_DIABETES.tirMinPct}%.`,
  );
}
