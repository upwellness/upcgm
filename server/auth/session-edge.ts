/**
 * The same HMAC check as session.ts, written against Web Crypto so middleware can
 * run it. Kept as a separate file rather than a shared one because importing
 * `node:crypto` — even along a branch that never executes — pulls the whole
 * module into the middleware bundle and fails the build.
 *
 * The signing format must stay identical to signSession() in session.ts.
 */

export const SESSION_COOKIE = 'upcgm_s';

function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  // Constant time over the compared length. The lengths themselves are public
  // (both are SHA-256 digests), so the early return above leaks nothing.
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifySessionEdge(token: string | undefined | null, secret: string | undefined): Promise<boolean> {
  if (!token || !secret || secret.length < 32) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  let given: Uint8Array;
  try { given = b64uToBytes(mac); } catch { return false; }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  if (!equal(given, expected)) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64uToBytes(body))) as { v?: number; exp?: number };
    if (payload.v !== 1) return false;
    return typeof payload.exp === 'number' && payload.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
