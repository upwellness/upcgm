import type { AnalysisResult, GlucoseLoweringMeds, MealMarker, MealResponse } from '@/lib/types';
import { fmtDuration, fmtThaiDate, fmtTime, pctToMinutesPerDay } from '@/lib/time';
import { DEVICE_FLOOR, TARGETS_ADULT_DIABETES, gateForWindow } from './thresholds';

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
  opts: { meds: GlucoseLoweringMeds; markers?: MealMarker[]; responses?: MealResponse[] },
): Interpretation {
  const m = result.metrics;
  const q = result.quality;
  const gate = gateForWindow(q.spanDays, q.capturePct);
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
      titleTh: 'มีช่วงน้ำตาลต่ำระดับรุนแรง เกินเกณฑ์ที่ยอมรับได้',
      evidenceTh: `ต่ำกว่า 54 มก./ดล. ${pct(m.tbrUnder54)} ของเวลา (≈ ${fmtDuration(pctToMinutesPerDay(m.tbrUnder54))}/วัน) — เกณฑ์สากลคือไม่เกิน ${TARGETS_ADULT_DIABETES.tbr54MaxPct}%`,
      actionTh:
        opts.meds === 'yes'
          ? 'พาเคสไปคุยกับแพทย์ผู้สั่งยาก่อนปรับอะไรเรื่องอาหาร เพราะช่วงต่ำแบบนี้มักเกี่ยวกับขนาดยาหรือจังหวะการกินยา — เรื่องนี้อยู่นอกขอบเขตของโค้ช'
          : 'บันทึกว่าช่วงต่ำเกิดตอนไหน ทำอะไรอยู่ กินอะไรมื้อก่อนหน้า แล้วให้เคสเล่าให้แพทย์ฟัง',
      basis: 'consensus',
    });
  }

  if (severe.length > 0 && !findings.some((f) => f.id === 'tbr54')) {
    escalate = true;
    const worst = severe.reduce((a, b) => (a.nadir <= b.nadir ? a : b));
    findings.push({
      id: 'severe-low-event',
      severity: 'urgent',
      titleTh: `พบช่วงน้ำตาลต่ำรุนแรง ${severe.length} ครั้ง`,
      evidenceTh: `ต่ำสุดที่ ${worst.nadir} มก./ดล. · ${fmtThaiDate(worst.from)} เวลา ${fmtTime(worst.from)} นาน ${fmtDuration(worst.minutes)}`,
      actionTh: 'ให้เคสเล่าอาการช่วงนั้นให้แพทย์ฟัง พร้อมเวลาที่เกิด',
      basis: 'consensus',
    });
  }

  const overnight = realLows.filter((e) => e.overnight);
  if (overnight.length > 0) {
    findings.push({
      id: 'overnight-low',
      severity: severe.length > 0 ? 'attention' : 'watch',
      titleTh: `น้ำตาลต่ำตอนกลางคืน ${overnight.length} ครั้ง`,
      evidenceTh: overnight
        .slice(0, 3)
        .map((e) => `${fmtThaiDate(e.from)} ${fmtTime(e.from)} ต่ำสุด ${e.nadir}`)
        .join(' · '),
      actionTh: 'ช่วงนี้คนไข้มักหลับอยู่และไม่รู้ตัว — คุ้มที่จะเล่าให้แพทย์ฟังแม้จะไม่มีอาการ',
      // We call 00:00–06:00 "night". No consensus defines the window.
      basis: 'house',
    });
  }

  if (gate.showRangePercents && m.tbrUnder70 > TARGETS_ADULT_DIABETES.tbr70MaxPct && m.tbrUnder54 <= TARGETS_ADULT_DIABETES.tbr54MaxPct) {
    findings.push({
      id: 'tbr70',
      severity: 'attention',
      titleTh: 'เวลาที่น้ำตาลต่ำกว่า 70 มากกว่าเกณฑ์',
      evidenceTh: `${pct(m.tbrUnder70)} ของเวลา (เกณฑ์ ≤ ${TARGETS_ADULT_DIABETES.tbr70MaxPct}%) ≈ ${fmtDuration(pctToMinutesPerDay(m.tbrUnder70))}/วัน`,
      actionTh: 'ดูว่าช่วงต่ำตรงกับหลังออกกำลังกาย หลังอดมื้อ หรือหลังกินยาไหม แล้วเล่าให้แพทย์ฟัง',
      basis: 'consensus',
    });
  }

  // ---- then the bulk of the day ----
  if (gate.showRangePercents) {
    if (m.tir70_180 >= TARGETS_ADULT_DIABETES.tirMinPct) {
      findings.push({
        id: 'tir-good',
        severity: 'good',
        titleTh: 'เวลาที่อยู่ในช่วงเป้าหมายผ่านเกณฑ์',
        evidenceTh: `อยู่ในช่วง 70–180 ${pct(m.tir70_180)} ของเวลา (เกณฑ์ ≥ ${TARGETS_ADULT_DIABETES.tirMinPct}%)`,
        actionTh: null,
        basis: 'consensus',
      });
    } else {
      findings.push({
        id: 'tir-low',
        severity: m.tir70_180 < 50 ? 'urgent' : 'attention',
        titleTh: 'เวลาที่อยู่ในช่วงเป้าหมายยังน้อยกว่าเกณฑ์',
        evidenceTh: `อยู่ในช่วง 70–180 ${pct(m.tir70_180)} (เกณฑ์ ≥ ${TARGETS_ADULT_DIABETES.tirMinPct}%) — ขาดอีก ${(TARGETS_ADULT_DIABETES.tirMinPct - m.tir70_180).toFixed(1)} จุด`,
        actionTh: 'เริ่มจากมื้อที่ทำให้ขึ้นสูงสุดก่อน 1 มื้อ ไม่ต้องแก้ทุกมื้อพร้อมกัน',
        basis: 'consensus',
      });
    }

    if (m.tarOver250 > TARGETS_ADULT_DIABETES.tar250MaxPct) {
      findings.push({
        id: 'tar250',
        severity: 'attention',
        titleTh: 'มีช่วงน้ำตาลสูงมาก',
        evidenceTh: `สูงกว่า 250 มก./ดล. ${pct(m.tarOver250)} ของเวลา (เกณฑ์ ≤ ${TARGETS_ADULT_DIABETES.tar250MaxPct}%) ≈ ${fmtDuration(pctToMinutesPerDay(m.tarOver250))}/วัน`,
        actionTh: 'ดูว่าเกิดหลังมื้อไหนซ้ำ ๆ — ถ้าเกิดทุกวันในเวลาเดียวกัน มื้อนั้นคือจุดเริ่ม',
        basis: 'consensus',
      });
    }
  }

  if (gate.showCv) {
    if (m.cv > TARGETS_ADULT_DIABETES.cvMaxPct) {
      findings.push({
        id: 'cv-high',
        severity: 'attention',
        titleTh: 'น้ำตาลแกว่งมากกว่าเกณฑ์',
        evidenceTh: `ค่าความแปรปรวน (CV) ${pct(m.cv)} — เกณฑ์คือไม่เกิน ${TARGETS_ADULT_DIABETES.cvMaxPct}%`,
        actionTh: 'ความแกว่งมักมาจากมื้อที่คาร์บเยอะและเร็ว มากกว่ามาจากปริมาณรวมทั้งวัน',
        basis: 'consensus',
      });
    } else {
      findings.push({
        id: 'cv-ok',
        severity: 'good',
        titleTh: 'ความแกว่งของน้ำตาลอยู่ในเกณฑ์',
        evidenceTh: `CV ${pct(m.cv)} (เกณฑ์ ≤ ${TARGETS_ADULT_DIABETES.cvMaxPct}%)`,
        actionTh: null,
        basis: 'consensus',
      });
    }
  }

  // ---- meals: the part a coach can actually change ----
  const paired = (opts.responses ?? [])
    .map((r) => ({ r, marker: (opts.markers ?? []).find((mk) => mk.id === r.markerId) }))
    .filter((p): p is { r: MealResponse; marker: MealMarker } => !!p.marker && p.r.delta != null);

  if (paired.length > 0) {
    const worst = paired.reduce((a, b) => ((a.r.delta ?? 0) >= (b.r.delta ?? 0) ? a : b));
    findings.push({
      id: 'meal-peak',
      severity: (worst.r.delta ?? 0) > 60 ? 'attention' : 'watch',
      titleTh: `มื้อที่ดันน้ำตาลขึ้นมากที่สุดคือ “${worst.marker.label}” (${fmtThaiDate(worst.marker.t)} ${fmtTime(worst.marker.t)})`,
      evidenceTh:
        `ขึ้น +${Math.round(worst.r.delta ?? 0)} มก./ดล. ` +
        `จาก ${Math.round(worst.r.baseline ?? 0)} ไปสูงสุด ${Math.round(worst.r.peak ?? 0)} ` +
        `ใน ${worst.r.minutesToPeak} นาที` +
        (worst.r.minutesToBaseline != null ? ` และกลับลงมาที่เดิมใน ${fmtDuration(worst.r.minutesToBaseline)}` : ' (ยังไม่กลับลงมาที่เดิมในช่วง 3 ชั่วโมงที่ดู)'),
      actionTh: 'ลองมื้อเดิมแต่กินผัก/โปรตีนก่อนคาร์บ แล้วเดิน 10–15 นาทีหลังมื้อ อีก 2–3 วันมาเทียบกราฟกัน',
      basis: 'house',
    });

    const slow = paired.filter((p) => p.r.minutesToBaseline == null || p.r.minutesToBaseline > 180);
    if (slow.length > 0 && slow.length === paired.length) {
      findings.push({
        id: 'slow-return',
        severity: 'watch',
        titleTh: 'น้ำตาลใช้เวลานานกว่าจะกลับลงมาที่เดิมหลังอาหาร',
        evidenceTh: `${slow.length} จาก ${paired.length} มื้อที่บันทึกไว้ ยังไม่กลับถึงระดับก่อนอาหารภายใน 3 ชั่วโมง`,
        actionTh: 'ระยะเวลากลับลงมาที่เดิมมักขยับได้เร็วกว่าน้ำหนัก — ใช้เป็นตัวชี้ผลระยะสั้นได้ดี',
        basis: 'house',
      });
    }
  }

  // ---- data quality is a finding, not a footnote ----
  if (!q.meetsFourteenDays || !q.meetsSeventyPercent) {
    findings.push({
      id: 'data-span',
      severity: 'watch',
      titleTh: 'ข้อมูลยังสั้นกว่าที่เกณฑ์สากลใช้ตัดสิน',
      evidenceTh: `มีข้อมูล ${q.spanDays.toFixed(1)} วัน · เก็บได้ ${q.capturePct.toFixed(0)}% ของเวลา — เกณฑ์คือ 14 วันและ 70%`,
      actionTh: 'อ่านเป็นแนวโน้มได้ แต่ยังไม่ควรใช้ตัวเลขนี้ไปเทียบเกณฑ์แบบเป๊ะ ๆ',
      basis: 'consensus',
    });
  }

  const artifacts = q.qcNotes.filter((n) => n.kind === 'floor-artifact');
  if (artifacts.length > 0) {
    const minutes = artifacts.reduce((s, n) => s + n.minutes, 0);
    findings.push({
      id: 'sensor-artifact',
      severity: 'watch',
      titleTh: 'มีช่วงที่เซนเซอร์น่าจะหลุด/ถูกกดทับ',
      evidenceTh: `${artifacts.length} ช่วง รวม ${fmtDuration(minutes)} ที่ค่าตกไปติดพื้นเครื่อง (${DEVICE_FLOOR} มก./ดล.) แบบที่ร่างกายลงเร็วขนาดนั้นไม่ได้ — ตัดออกจากการคำนวณแล้ว`,
      actionTh: 'ถ้าเกิดตอนกลางคืนซ้ำ ๆ มักเป็นการนอนทับ ลองเปลี่ยนข้างที่ติดเซนเซอร์',
      basis: 'house',
    });
  }

  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  const limitationsTh = [
    'เครื่อง CGM วัดน้ำตาลในน้ำระหว่างเซลล์ ไม่ใช่ในเลือดโดยตรง ค่าจะตามหลังเลือดจริงประมาณ 5–15 นาที',
    'รายงานนี้อ่านจากไฟล์ที่ส่งเข้ามาเท่านั้น ไม่ใช่การวินิจฉัย และไม่ใช่คำสั่งปรับยา',
  ];
  if (gate.noteTh) limitationsTh.unshift(gate.noteTh);
  if (opts.meds === 'unknown') {
    limitationsTh.push('ยังไม่ได้ระบุว่าเคสใช้ยาลดน้ำตาลอยู่หรือไม่ — ข้อสรุปเรื่องช่วงน้ำตาลต่ำจึงตีความได้จำกัด');
  }

  const headlineTh = buildHeadline(m, gate.showRangePercents, escalate);
  return { headlineTh, findings, limitationsTh, escalate };
}

function buildHeadline(
  m: AnalysisResult['metrics'],
  showPercents: boolean,
  escalate: boolean,
): string {
  if (escalate) return 'เรื่องที่ต้องคุยก่อนอย่างอื่น: มีช่วงน้ำตาลต่ำที่ต้องให้แพทย์ดู';
  if (!showPercents) return `ค่าเฉลี่ยในช่วงที่เลือก ${Math.round(m.mean)} มก./ดล.`;
  if (m.tir70_180 >= TARGETS_ADULT_DIABETES.tirMinPct && m.cv <= TARGETS_ADULT_DIABETES.cvMaxPct) {
    return `ภาพรวมดี — อยู่ในช่วงเป้าหมาย ${pct(m.tir70_180)} และแกว่งไม่มาก`;
  }
  if (m.tir70_180 >= TARGETS_ADULT_DIABETES.tirMinPct) {
    return `อยู่ในช่วงเป้าหมาย ${pct(m.tir70_180)} ผ่านเกณฑ์ แต่ยังแกว่งมาก (CV ${pct(m.cv)})`;
  }
  return `อยู่ในช่วงเป้าหมาย ${pct(m.tir70_180)} — เป้าหมายถัดไปคือ ${TARGETS_ADULT_DIABETES.tirMinPct}%`;
}
