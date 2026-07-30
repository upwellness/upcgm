// Generate a passcode entry for UPCGM_PASSCODES.
// Usage: node scripts/passcode.mjs <label> [expiryYYYY-MM-DD]
import { randomBytes, scryptSync } from 'node:crypto';

const label = process.argv[2];
const expiry = process.argv[3];
if (!label || !/^[a-z0-9_-]+$/i.test(label)) {
  console.error('usage: node scripts/passcode.mjs <label> [YYYY-MM-DD]   (label: a-z 0-9 _ -)');
  process.exit(1);
}
// 10 chars of a-z0-9 — 3.6e15 combinations, versus 1e6 for six digits. Same
// effort to type with a paste button, a billion times harder to guess.
const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
const bytes = randomBytes(10);
const passcode = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(passcode.normalize('NFKC'), Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');

console.log(`\npasscode to hand out : ${passcode}`);
console.log(`entry for UPCGM_PASSCODES:\n${[label, salt, hash, expiry].filter(Boolean).join(':')}\n`);
console.log('Append to the env var, comma separated. Changing env on Vercel needs a redeploy.\n');
