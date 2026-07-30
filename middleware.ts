import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionEdge } from '@/server/auth/session-edge';

/**
 * Deny by default. Everything not named here needs a valid session — including
 * any route added later, which is the point: a new page cannot be published
 * unprotected by forgetting to add it to a list.
 */
const PUBLIC_PATHS = ['/gate', '/api/session', '/favicon.ico', '/robots.txt'];

export async function middleware(req: NextRequest) {
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
