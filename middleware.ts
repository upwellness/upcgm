import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionEdge } from '@/server/auth/session-edge';

/**
 * Passcode gate — currently OFF.
 *
 * Flip this back to true to require a passcode again. Everything the gate needs
 * is still here and still tested (the /gate page, /api/session, the scrypt
 * verification in server/auth), so turning it back on is this one line and
 * nothing else.
 *
 * Running open is defensible for THIS tool because it stores no patient data:
 * the uploaded file is read from the request stream and never written to disk
 * or a database, and meal markers live in the coach's own browser. What an open
 * door does expose is free use of the tool and the interpretation thresholds
 * that sit behind /api — which is why this is a deliberate switch and not a
 * deletion.
 */
const GATE_ENABLED = false;

/**
 * Deny by default while the gate is on. Everything not named here needs a valid
 * session — including any route added later, which is the point: a new page
 * cannot be published unprotected by forgetting to add it to a list.
 */
const PUBLIC_PATHS = ['/gate', '/api/session', '/favicon.ico', '/robots.txt'];

export async function middleware(req: NextRequest) {
  if (!GATE_ENABLED) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const ok = await verifySessionEdge(req.cookies.get(SESSION_COOKIE)?.value, process.env.UPCGM_SESSION_SECRET);
  if (ok) return NextResponse.next();

  // An expired session on an API call must read as 401, not as a redirect to an
  // HTML page — otherwise fetch() gets HTML and reports a JSON parse error,
  // which sends whoever debugs it looking in the wrong place entirely.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'session-expired' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/gate';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
