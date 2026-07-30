import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPasscode, newSalt, signSession, verifyPasscode, verifySession } from '@/server/auth/session';
import { verifySessionEdge } from '@/server/auth/session-edge';
import { rateLimit } from '@/server/rate-limit';

const SECRET = 'x'.repeat(48);

function entry(label: string, passcode: string, expires?: string): string {
  const salt = newSalt();
  return [label, salt, hashPasscode(passcode, salt), expires].filter(Boolean).join(':');
}

describe('passcode verification', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.UPCGM_SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('accepts a configured passcode and reports which entry matched', () => {
    process.env.UPCGM_PASSCODES = [entry('coach-a', 'alpha12345'), entry('coach-b', 'bravo67890')].join(',');
    expect(verifyPasscode('bravo67890')).toEqual({ ok: true, label: 'coach-b' });
  });

  it('rejects a wrong passcode', () => {
    process.env.UPCGM_PASSCODES = entry('coach-a', 'alpha12345');
    expect(verifyPasscode('alpha12346')).toMatchObject({ ok: false, reason: 'mismatch' });
  });

  it('distinguishes "we never configured this" from "you typed it wrong"', () => {
    // A coach retyping a correct code twenty times because we forgot the env var
    // is a support call we can avoid by naming the real cause.
    delete process.env.UPCGM_PASSCODES;
    expect(verifyPasscode('anything')).toMatchObject({ ok: false, reason: 'no-config' });
  });

  it('refuses an expired entry without disabling the others', () => {
    process.env.UPCGM_PASSCODES = [
      entry('old', 'expired123', '2020-01-01'),
      entry('current', 'valid45678'),
    ].join(',');
    expect(verifyPasscode('expired123')).toMatchObject({ ok: false, reason: 'expired' });
    expect(verifyPasscode('valid45678')).toMatchObject({ ok: true, label: 'current' });
  });

  it('ignores surrounding whitespace, which paste always brings along', () => {
    process.env.UPCGM_PASSCODES = entry('coach-a', 'alpha12345');
    expect(verifyPasscode('  alpha12345 ').ok).toBe(true);
  });

  it('does not treat an empty passcode as a match for anything', () => {
    process.env.UPCGM_PASSCODES = entry('coach-a', 'alpha12345');
    expect(verifyPasscode('').ok).toBe(false);
  });
});

describe('session token', () => {
  beforeEach(() => {
    process.env.UPCGM_SESSION_SECRET = SECRET;
  });

  it('round-trips a signed session', () => {
    const token = signSession('coach-a');
    expect(verifySession(token)?.label).toBe('coach-a');
  });

  it('rejects a tampered payload', () => {
    const token = signSession('coach-a');
    const [body, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, label: 'admin', iat: 0, exp: 9e9 })).toString('base64url');
    expect(verifySession(`${forged}.${mac}`)).toBeNull();
    expect(verifySession(`${body}.${'a'.repeat(mac.length)}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession('coach-a');
    process.env.UPCGM_SESSION_SECRET = 'y'.repeat(48);
    expect(verifySession(token)).toBeNull();
  });

  it('rejects an expired token', () => {
    const body = Buffer.from(JSON.stringify({ v: 1, label: 'a', iat: 0, exp: 1 })).toString('base64url');
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const mac = createHmac('sha256', SECRET).update(body).digest('base64url');
    expect(verifySession(`${body}.${mac}`)).toBeNull();
  });

  it('rejects junk instead of throwing', () => {
    for (const bad of ['', 'nodot', 'a.b.c.d', '....', 'null']) {
      expect(verifySession(bad)).toBeNull();
    }
  });

  it('refuses to sign when the secret is missing or too short', () => {
    process.env.UPCGM_SESSION_SECRET = 'short';
    expect(() => signSession('coach-a')).toThrow();
    delete process.env.UPCGM_SESSION_SECRET;
    expect(() => signSession('coach-a')).toThrow();
  });
});

describe('edge verifier agrees with the node verifier', () => {
  // Middleware runs the Web Crypto copy. If the two implementations ever drift,
  // every request either passes the gate wrongly or fails it wrongly — so they
  // are checked against each other rather than each against itself.
  beforeEach(() => {
    process.env.UPCGM_SESSION_SECRET = SECRET;
  });

  it('accepts what node signed', async () => {
    const token = signSession('coach-a');
    expect(await verifySessionEdge(token, SECRET)).toBe(true);
  });

  it('rejects the same things node rejects', async () => {
    const token = signSession('coach-a');
    expect(await verifySessionEdge(token, 'y'.repeat(48))).toBe(false);
    expect(await verifySessionEdge(`${token}x`, SECRET)).toBe(false);
    expect(await verifySessionEdge(undefined, SECRET)).toBe(false);
    expect(await verifySessionEdge(token, undefined)).toBe(false);
    expect(await verifySessionEdge(token, 'tooshort')).toBe(false);
  });
});

describe('rate limit', () => {
  it('allows up to the limit then refuses with a wait time', () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(rateLimit(key, 5, 60).allowed).toBe(true);
    const blocked = rateLimit(key, 5, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps separate keys separate, so one coach cannot lock out another', () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    for (let i = 0; i < 5; i++) rateLimit(a, 5, 60);
    expect(rateLimit(a, 5, 60).allowed).toBe(false);
    expect(rateLimit(b, 5, 60).allowed).toBe(true);
  });
});
