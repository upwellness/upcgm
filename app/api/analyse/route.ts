import { NextResponse } from 'next/server';
import { analyse } from '@/server/cgm/analyse';
import { ParseError } from '@/server/cgm/parse';
import { clientKey, rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
/** A 60,000-row workbook takes a few seconds to parse on a cold instance. */
export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * The whole reason parsing happens here and not in the browser: the sheet-column
 * synonyms, the unit conversion, the device-floor rules and the band boundaries
 * are the accumulated result of reading thirteen real exports. Shipping them to
 * the client ships the product.
 *
 * The file itself is read from the request stream and never written to disk.
 */
export async function POST(req: Request) {
  const verdict = rateLimit(`analyse:${clientKey(req.headers)}`, 30, 600);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: 'too-many', messageTh: `อัปโหลดถี่เกินไป รออีก ${verdict.retryAfterSeconds} วินาที` },
      { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
    );
  }

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES + 4096) {
    return NextResponse.json(
      { error: 'too-large', messageTh: 'ไฟล์ใหญ่เกิน 5 MB — ไฟล์ CGM ปกติไม่ถึง 1 MB' },
      { status: 413 },
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: 'bad-form', messageTh: 'อ่านไฟล์ที่ส่งมาไม่ได้' }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: 'no-file', messageTh: 'ยังไม่ได้เลือกไฟล์' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'too-large', messageTh: 'ไฟล์ใหญ่เกิน 5 MB' }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  try {
    const result = analyse(buf, file.name || 'upload.xlsx');
    return NextResponse.json(result, {
      // Health data in a shared browser cache is the kind of mistake that only
      // shows up when the wrong person opens the wrong tab.
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (err) {
    if (err instanceof ParseError) {
      // These messages are written for the coach reading the screen, in Thai,
      // and carry the status the parser chose.
      return NextResponse.json({ error: 'parse', messageTh: err.message }, { status: err.status });
    }
    // Never echo the raw message: SheetJS errors can carry cell contents.
    console.error('[analyse] unexpected', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'unexpected', messageTh: 'อ่านไฟล์นี้ไม่สำเร็จ ลองส่งไฟล์ต้นฉบับที่ดาวน์โหลดจากแอปเครื่อง CGM โดยตรง' },
      { status: 500 },
    );
  }
}
