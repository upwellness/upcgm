import { NextResponse } from 'next/server';
import type { AnalysisResult, GlucoseLoweringMeds, MealMarker, MealResponse } from '@/lib/types';
import { interpret } from '@/server/cgm/interpret';
import { clientKey, rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * The findings are computed by rules in server/cgm/interpret.ts and are what the
 * screen and the A4 sheet actually display. This route only asks a model to
 * write the two-paragraph opening a coach reads out loud.
 *
 * If no key is configured, or the model is unreachable, or it comes back with
 * something that trips the safety check, the page still has every finding — it
 * just loses the paragraph. A wellness tool must never depend on a third party
 * being up to say something true about a low blood sugar.
 */

const MODEL = process.env.UPCGM_AI_MODEL ?? 'claude-sonnet-5';

/** Anything the model must not say, regardless of how the numbers look. */
const FORBIDDEN = [
  /ปรับ(?:ขนาด)?ยา/, /เพิ่มยา/, /ลดยา/, /หยุดยา/, /เลิกยา/,
  /วินิจฉัย/, /เป็นเบาหวาน(?:แล้ว|ชัด)/, /รักษาให้หาย/, /หายขาด/,
  /nutrilite/i, /อาหารเสริม/, /ผลิตภัณฑ์/, /สั่งซื้อ/,
];

function safe(text: string): { ok: boolean; hit?: string } {
  for (const re of FORBIDDEN) {
    const m = re.exec(text);
    if (m) return { ok: false, hit: m[0] };
  }
  return { ok: true };
}

interface Body {
  result?: AnalysisResult;
  meds?: GlucoseLoweringMeds;
  markers?: MealMarker[];
  responses?: MealResponse[];
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ narrative: null, reasonTh: 'คำขอไม่ถูกต้อง' }, { status: 400 });
  }
  if (!body.result?.metrics) {
    return NextResponse.json({ narrative: null, reasonTh: 'ยังไม่มีผลวิเคราะห์' }, { status: 400 });
  }

  const interpretation = interpret(body.result, {
    meds: body.meds ?? 'unknown',
    markers: body.markers,
    responses: body.responses,
  });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || process.env.UPCGM_AI_DISABLED === '1') {
    return NextResponse.json({
      interpretation,
      narrative: null,
      reasonTh: 'ยังไม่ได้เปิดใช้สรุปด้วย AI — ข้อค้นพบทั้งหมดด้านล่างคำนวณจากเกณฑ์ตรง ๆ อยู่แล้ว',
    });
  }

  // Quota guards the model call only. The findings above are free and must not
  // disappear because someone re-ranged the chart twenty times.
  const verdict = rateLimit(`ai:${clientKey(req.headers)}`, 20, 3600);
  if (!verdict.allowed) {
    return NextResponse.json({
      interpretation,
      narrative: null,
      reasonTh: `ใช้สรุปด้วย AI ครบโควตาชั่วโมงนี้แล้ว รออีก ${Math.ceil(verdict.retryAfterSeconds / 60)} นาที`,
    });
  }

  const m = body.result.metrics;
  const q = body.result.quality;
  // Only aggregates leave this server. The 3,000-point series never does.
  const facts = [
    `ช่วงข้อมูล ${q.spanDays.toFixed(1)} วัน เก็บได้ ${q.capturePct.toFixed(0)}%`,
    `ค่าเฉลี่ย ${m.mean.toFixed(0)} มก./ดล.`,
    `อยู่ในช่วง 70–180 = ${m.tir70_180.toFixed(1)}%`,
    `อยู่ในช่วง 70–140 = ${m.titr70_140.toFixed(1)}%`,
    `ต่ำกว่า 70 = ${m.tbrUnder70.toFixed(1)}% · ต่ำกว่า 54 = ${m.tbrUnder54.toFixed(1)}%`,
    `สูงกว่า 180 = ${m.tarOver180.toFixed(1)}% · สูงกว่า 250 = ${m.tarOver250.toFixed(1)}%`,
    `CV = ${m.cv.toFixed(1)}%`,
    m.gmi != null ? `GMI ≈ ${m.gmi.toFixed(1)}%` : 'ช่วงข้อมูลสั้นเกินกว่าจะคิด GMI',
    `ใช้ยาลดน้ำตาลอยู่: ${body.meds === 'yes' ? 'ใช่' : body.meds === 'no' ? 'ไม่' : 'ไม่ระบุ'}`,
    ...interpretation.findings.map((f) => `[${f.severity}] ${f.titleTh} — ${f.evidenceTh}`),
  ].join('\n');

  const system = [
    'คุณช่วยโค้ชสุขภาพเรียบเรียงคำพูดเปิดบทสนทนากับเคส จากผลเครื่องวัดน้ำตาลต่อเนื่อง (CGM)',
    'เขียนภาษาไทยที่คนทั่วไปเข้าใจ 2 ย่อหน้า ไม่เกิน 120 คำรวม',
    'ย่อหน้าแรก: ภาพรวมพร้อมตัวเลขที่สำคัญที่สุด 1–2 ตัว',
    'ย่อหน้าสอง: สิ่งที่ควรลองก่อน 1 อย่าง เป็นพฤติกรรม (อาหาร/ลำดับการกิน/เดินหลังมื้อ/การนอน) เท่านั้น',
    'ห้ามพูดถึงยา ขนาดยา การปรับยา การวินิจฉัยโรค ผลิตภัณฑ์ อาหารเสริม หรือการซื้อขาย',
    'ห้ามสร้างตัวเลขใหม่ ใช้เฉพาะตัวเลขที่ให้มา',
    'ถ้าข้อค้นพบมีระดับ urgent ให้ขึ้นต้นด้วยการแนะนำให้ปรึกษาแพทย์',
    'ตอบเป็นข้อความล้วน ไม่ใส่หัวข้อ ไม่ใส่ bullet',
  ].join('\n');

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: facts }],
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ interpretation, narrative: null, reasonTh: 'เรียกสรุปด้วย AI ไม่สำเร็จ — ใช้ข้อค้นพบตามเกณฑ์ด้านล่างได้เลย' });
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
    if (!text) {
      return NextResponse.json({ interpretation, narrative: null, reasonTh: 'ไม่ได้ข้อความกลับมา' });
    }

    const check = safe(text);
    if (!check.ok) {
      console.warn('[ai] blocked narrative, matched:', check.hit);
      return NextResponse.json({
        interpretation,
        narrative: null,
        reasonTh: 'ข้อความที่ได้กลับมาแตะเรื่องที่อยู่นอกขอบเขตของเครื่องมือนี้ จึงไม่แสดง — ข้อค้นพบตามเกณฑ์ด้านล่างยังใช้ได้ตามปกติ',
      });
    }

    return NextResponse.json({ interpretation, narrative: text, reasonTh: null });
  } catch {
    return NextResponse.json({ interpretation, narrative: null, reasonTh: 'สรุปด้วย AI ใช้เวลานานเกินไป — ข้ามไปก่อน' });
  }
}
