/**
 * Per-instance sliding window. Serverless means several instances, so the real
 * ceiling is roughly limit × instances — enough to blunt a script, not enough to
 * call it a security control. It is here because the alternative (nothing) lets
 * one loop try every six-digit code; the passcodes are ten characters partly
 * because this limiter cannot be trusted alone.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export interface Verdict {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export function rateLimit(key: string, limit: number, windowSeconds: number): Verdict {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  // Sweep occasionally rather than per call: a map that only ever grows is how a
  // long-lived instance turns into a memory leak.
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) {
      if (b.hits.every((t) => now - t > windowMs)) buckets.delete(k);
    }
    lastSweep = now;
  }

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    buckets.set(key, bucket);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
      remaining: 0,
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { allowed: true, retryAfterSeconds: 0, remaining: limit - bucket.hits.length };
}

/** Vercel sets x-forwarded-for; the left-most entry is the client. */
export function clientKey(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return headers.get('x-real-ip') ?? 'unknown';
}
