import { NextResponse } from 'next/server';
import { asLocale, tx } from '@/server/cgm/i18n';
import type { AnalysisResult, GlucoseLoweringMeds, MealMarker, MealResponse } from '@/lib/types';
import { interpret } from '@/server/cgm/interpret';
import { patternDefs } from '@/server/cgm/patterns';
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

/**
 * The coach brings the key and picks the model on /config. The env var is only a
 * fallback for a deployment that wants one key for everybody.
 */
const FALLBACK_MODEL = process.env.UPCGM_AI_MODEL ?? 'gemini-flash-latest';

/**
 * Anything the model must not say, regardless of how the numbers look.
 *
 * Both languages are checked on every reply, not just the one that was asked
 * for: the guard is the last thing standing between a model and a coach reading
 * dosing advice out loud, and a model asked for Thai will still answer in
 * English when it feels like it.
 */
const FORBIDDEN = [
  // Thai
  /ปรับ(?:ขนาด)?ยา/, /เพิ่มยา/, /ลดยา/, /หยุดยา/, /เลิกยา/,
  /วินิจฉัย/, /เป็นเบาหวาน(?:แล้ว|ชัด)/, /รักษาให้หาย/, /หายขาด/,
  /nutrilite/i, /อาหารเสริม/, /ผลิตภัณฑ์/, /สั่งซื้อ/,
  // English
  /\b(?:adjust|increase|raise|lower|reduce|stop|change|titrat\w*)\s+(?:your\s+|the\s+|his\s+|her\s+)?(?:dose|dosage|medication|meds|insulin|metformin)\b/i,
  /\b(?:dose|dosage)\s+(?:should|needs?|ought)\b/i,
  /\bdiagnos(?:e|is|ed|ing)\b/i,
  /\byou (?:have|are) (?:diabet|prediabet)\w*/i,
  /\bcure[sd]?\b/i, /\breverse (?:your )?diabetes\b/i,
  /\bsupplements?\b/i, /\bproducts?\b/i, /\b(?:buy|purchase|order)\b/i,
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
  /** the coach's own Gemini key, held in their browser, used once, never stored */
  aiKey?: string;
  aiModel?: string;
  /** true only when the coach pressed the button, so the findings render without
   *  ever calling out to a third party on their own */
  wantNarrative?: boolean;
}

export async function POST(req: Request) {
  const locale = asLocale((await req.clone().json().catch(() => ({}))).locale);
  const t = tx(locale);
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ narrative: null, reasonTh: t('คำขอไม่ถูกต้อง', 'Malformed request.') }, { status: 400 });
  }
  if (!body.result?.metrics) {
    return NextResponse.json({ narrative: null, reasonTh: t('ยังไม่มีผลวิเคราะห์', 'No analysis to summarise yet.') }, { status: 400 });
  }

  const interpretation = interpret(body.result, {
    locale,
    meds: body.meds ?? 'unknown',
    markers: body.markers,
    responses: body.responses,
  });

  // The findings are always returned. The model call happens only when the coach
  // asked for it AND supplied a key — this route must never reach out to anyone
  // just because a chart was re-ranged.
  const key = (body.aiKey ?? '').trim() || (process.env.UPCGM_GEMINI_API_KEY ?? '').trim();
  const model = (body.aiModel ?? '').trim() || FALLBACK_MODEL;

  if (!body.wantNarrative) {
    return NextResponse.json({ interpretation, narrative: null, reasonTh: null });
  }
  if (process.env.UPCGM_AI_DISABLED === '1') {
    return NextResponse.json({
      interpretation, narrative: null,
      reasonTh: 'ปิดการใช้ AI ไว้ที่ระบบ — ข้อค้นพบทั้งหมดด้านล่างคำนวณจากเกณฑ์ตรง ๆ อยู่แล้ว',
    });
  }
  if (!key) {
    return NextResponse.json({
      interpretation, narrative: null,
      reasonTh: 'ยังไม่ได้ใส่ API key — ไปที่หน้าตั้งค่าเพื่อเปิดใช้สรุปด้วย AI (ไม่ใส่ก็ใช้งานได้ครบทุกอย่าง)',
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
    t(`ช่วงข้อมูล ${q.spanDays.toFixed(1)} วัน เก็บได้ ${q.capturePct.toFixed(0)}%`, `Window ${q.spanDays.toFixed(1)} days, ${q.capturePct.toFixed(0)}% captured`),
    t(`ค่าเฉลี่ย ${m.mean.toFixed(0)} มก./ดล.`, `Average ${m.mean.toFixed(0)} mg/dL`),
    t(`อยู่ในช่วง 70–180 = ${m.tir70_180.toFixed(1)}%`, `In 70–180 = ${m.tir70_180.toFixed(1)}%`),
    t(`อยู่ในช่วง 70–140 = ${m.titr70_140.toFixed(1)}%`, `In 70–140 = ${m.titr70_140.toFixed(1)}%`),
    t(`ต่ำกว่า 70 = ${m.tbrUnder70.toFixed(1)}% · ต่ำกว่า 54 = ${m.tbrUnder54.toFixed(1)}%`, `Below 70 = ${m.tbrUnder70.toFixed(1)}% · below 54 = ${m.tbrUnder54.toFixed(1)}%`),
    t(`สูงกว่า 180 = ${m.tarOver180.toFixed(1)}% · สูงกว่า 250 = ${m.tarOver250.toFixed(1)}%`, `Above 180 = ${m.tarOver180.toFixed(1)}% · above 250 = ${m.tarOver250.toFixed(1)}%`),
    `CV = ${m.cv.toFixed(1)}%`,
    m.gmi != null ? `GMI ≈ ${m.gmi.toFixed(1)}%` : t('ช่วงข้อมูลสั้นเกินกว่าจะคิด GMI', 'Window too short to compute GMI'),
    t(
      `ใช้ยาลดน้ำตาลอยู่: ${body.meds === 'yes' ? 'ใช่' : body.meds === 'no' ? 'ไม่' : 'ไม่ระบุ'}`,
      `On glucose-lowering medication: ${body.meds === 'yes' ? 'yes' : body.meds === 'no' ? 'no' : 'not stated'}`,
    ),
    t(
      'รูปร่างกราฟหลังน้ำตาลขึ้น (คำที่ทีมตั้งเอง ไม่ใช่ศัพท์การแพทย์): ',
      'Post-rise curve shapes (names this team coined, not medical terms): ',
    ) +
      ((['crash', 'stuck', 'spike', 'wide', 'flat'] as const)
        .filter((k) => interpretation.eventSnapshot.counts[k] > 0)
        .map((k) => `${patternDefs(locale)[k].labelTh} ×${interpretation.eventSnapshot.counts[k]}`)
        .join(' · ') || t('ยังไม่พบช่วงที่อ่านรูปร่างได้', 'No readable rises yet')),
    interpretation.eventSnapshot.dominant
      ? t(
          `รูปร่างที่เจอบ่อยที่สุด: ${patternDefs(locale)[interpretation.eventSnapshot.dominant].labelTh} — ${patternDefs(locale)[interpretation.eventSnapshot.dominant].meaningTh}`,
          `Most common shape: ${patternDefs(locale)[interpretation.eventSnapshot.dominant].labelTh} — ${patternDefs(locale)[interpretation.eventSnapshot.dominant].meaningTh}`,
        )
      : t('ยังไม่มีรูปร่างไหนเด่นพอจะบอกว่าเป็นแพตเทิร์นประจำ', 'No shape stands out enough to call it a habit'),
    t(
      `จำนวนช่วงที่มาจากการสแกนเอง (ยืนยันไม่ได้ว่าเป็นอาหาร): ${interpretation.eventSnapshot.detected} · ที่โค้ชบันทึกเอง: ${interpretation.eventSnapshot.marked}`,
      `Rises found by scanning (food unconfirmed): ${interpretation.eventSnapshot.detected} · logged by the coach: ${interpretation.eventSnapshot.marked}`,
    ),
    ...interpretation.findings.map((f) => `[${f.severity}] ${f.titleTh} — ${f.evidenceTh}`),
  ].join('\n');

  const system = (locale === 'en'
    ? [
        'You help a health coach open a conversation with a client about their continuous glucose monitor (CGM) results.',
        'Write in plain English a general reader understands: two paragraphs, 120 words or fewer in total.',
        'First paragraph: the overall picture with the one or two numbers that matter most.',
        'Second paragraph: one thing to try first. Behaviour only — food, the order food is eaten in, a walk after a meal, sleep.',
        'Never mention medication, doses, changing a dose, diagnosing a condition, products, supplements, or buying anything.',
        'Never invent a number. Use only the numbers given to you.',
        'If you name a curve shape, use the words Spike/Wide/Stuck/Crash exactly as given, and do not present them as medical terms.',
        'Rises found by scanning must never be called "meals" — food cannot be confirmed as the cause. Call them "rises".',
        'If any finding is urgent, open by advising the client to speak to a doctor.',
        'Answer as plain prose. No headings, no bullets.',
      ]
    : [
        'คุณช่วยโค้ชสุขภาพเรียบเรียงคำพูดเปิดบทสนทนากับเคส จากผลเครื่องวัดน้ำตาลต่อเนื่อง (CGM)',
        'เขียนภาษาไทยที่คนทั่วไปเข้าใจ 2 ย่อหน้า ไม่เกิน 120 คำรวม',
        'ย่อหน้าแรก: ภาพรวมพร้อมตัวเลขที่สำคัญที่สุด 1–2 ตัว',
        'ย่อหน้าสอง: สิ่งที่ควรลองก่อน 1 อย่าง เป็นพฤติกรรม (อาหาร/ลำดับการกิน/เดินหลังมื้อ/การนอน) เท่านั้น',
        'ห้ามพูดถึงยา ขนาดยา การปรับยา การวินิจฉัยโรค ผลิตภัณฑ์ อาหารเสริม หรือการซื้อขาย',
        'ห้ามสร้างตัวเลขใหม่ ใช้เฉพาะตัวเลขที่ให้มา',
        'ถ้าพูดถึงรูปร่างกราฟ ให้ใช้คำว่า พุ่ง/กว้าง/ค้าง/ตก ตามที่ให้มา และอย่าอ้างว่าเป็นศัพท์ทางการแพทย์',
        'ช่วงที่มาจากการสแกนเอง ห้ามเรียกว่า "มื้ออาหาร" เพราะยืนยันไม่ได้ว่ามาจากอาหาร — เรียกว่า "ช่วงที่น้ำตาลขึ้น"',
        'ถ้าข้อค้นพบมีระดับ urgent ให้ขึ้นต้นด้วยการแนะนำให้ปรึกษาแพทย์',
        'ตอบเป็นข้อความล้วน ไม่ใส่หัวข้อ ไม่ใส่ bullet',
      ]
  ).join('\n');

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: facts }] }],
          generationConfig: { maxOutputTokens: 700, temperature: 0.4 },
        }),
        signal: ctl.signal,
      },
    );
    clearTimeout(timer);

    if (!res.ok) {
      // Pass Google's own words through. "API key not valid" and "model not
      // found" need different fixes, and a generic failure message sends the
      // coach to the wrong one.
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return NextResponse.json({
        interpretation,
        narrative: null,
        reasonTh: `เรียกสรุปด้วย AI ไม่สำเร็จ — Google ตอบว่า: ${err?.error?.message ?? `HTTP ${res.status}`} · ข้อค้นพบตามเกณฑ์ด้านล่างใช้ได้ตามปกติ`,
      });
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '').join('\n').trim();
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
