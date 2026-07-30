import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifyPasscode } from '@/server/auth/session';
import { clientKey, rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';

/** Eight tries per ten minutes per address. A coach mistypes twice, not eight times. */
const LIMIT = 8;
const WINDOW = 600;

export async function POST(req: Request) {
  const key = clientKey(req.headers);
  const verdict = rateLimit(`gate:${key}`, LIMIT, WINDOW);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: 'too-many', messageTh: `ลองผิดหลายครั้งเกินไป รอ ${verdict.retryAfterSeconds} วินาทีแล้วลองอีกครั้ง` },
      { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
    );
  }

  let passcode = '';
  try {
    const body = (await req.json()) as { passcode?: unknown };
    if (typeof body.passcode === 'string') passcode = body.passcode;
  } catch {
    return NextResponse.json({ error: 'bad-request', messageTh: 'คำขอไม่ถูกต้อง' }, { status: 400 });
  }
  if (!passcode || passcode.length > 128) {
    return NextResponse.json({ error: 'bad-request', messageTh: 'กรุณากรอกรหัสเข้าใช้งาน' }, { status: 400 });
  }

  const result = verifyPasscode(passcode);
  if (!result.ok) {
    // 'no-config' is our mistake, not the user's — say so plainly rather than
    // letting a coach retype a correct code twenty times.
    const messageTh =
      result.reason === 'no-config'
        ? 'ระบบยังไม่ได้ตั้งรหัสเข้าใช้งาน — แจ้งผู้ดูแลระบบ'
        : result.reason === 'expired'
          ? 'รหัสนี้หมดอายุแล้ว ขอรหัสใหม่จากผู้ดูแลระบบ'
          : 'รหัสไม่ถูกต้อง';
    return NextResponse.json({ error: result.reason, messageTh }, { status: result.reason === 'no-config' ? 500 : 401 });
  }

  let token: string;
  try {
    token = signSession(result.label!);
  } catch {
    return NextResponse.json({ error: 'no-secret', messageTh: 'ระบบยังตั้งค่าไม่ครบ — แจ้งผู้ดูแลระบบ' }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true, label: result.label });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
