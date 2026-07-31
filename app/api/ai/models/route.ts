import { NextResponse } from 'next/server';
import { clientKey, rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';

/**
 * Lists the models the coach's own key can actually reach.
 *
 * This exists because model names move faster than this app does. Rather than
 * hard-coding one and watching it 404 six months from now, the config screen
 * asks Google what this key is allowed to use and lets the coach pick. The key
 * is used for the one call and never stored.
 */
export async function POST(req: Request) {
  const verdict = rateLimit(`models:${clientKey(req.headers)}`, 20, 3600);
  if (!verdict.allowed) {
    return NextResponse.json(
      { ok: false, errorTh: `ลองบ่อยเกินไป รออีก ${Math.ceil(verdict.retryAfterSeconds / 60)} นาที` },
      { status: 429 },
    );
  }

  let apiKey = '';
  try {
    ({ apiKey } = (await req.json()) as { apiKey?: string } as { apiKey: string });
  } catch {
    return NextResponse.json({ ok: false, errorTh: 'คำขอไม่ถูกต้อง' }, { status: 400 });
  }
  if (!apiKey || apiKey.trim().length < 10) {
    return NextResponse.json({ ok: false, errorTh: 'ยังไม่ได้ใส่ API key' }, { status: 400 });
  }

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey.trim() },
      signal: ctl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      // Google's own message is far more useful than anything we could invent —
      // "API key not valid" vs "billing disabled" are different problems.
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return NextResponse.json({
        ok: false,
        errorTh: `Google ตอบกลับว่า: ${body?.error?.message ?? `HTTP ${res.status}`}`,
      });
    }

    const json = (await res.json()) as {
      models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
    };
    const models = (json.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => ({
        id: (m.name ?? '').replace(/^models\//, ''),
        label: m.displayName ?? (m.name ?? '').replace(/^models\//, ''),
      }))
      .filter((m) => m.id)
      // Flash tiers first: this app sends a few hundred tokens and wants an
      // answer while the coach is still looking at the screen.
      .sort((a, b) => {
        const rank = (id: string) => (id.includes('flash') ? 0 : id.includes('pro') ? 1 : 2);
        return rank(a.id) - rank(b.id) || b.id.localeCompare(a.id);
      });

    return NextResponse.json({ ok: true, models });
  } catch {
    return NextResponse.json({ ok: false, errorTh: 'ต่อกับ Google ไม่ได้ หรือใช้เวลานานเกินไป' });
  }
}
