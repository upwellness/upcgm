/**
 * The coach's own Gemini key, kept in their own browser.
 *
 * Why here and not in an env var on the server: each coach brings their own key
 * and their own quota, and we do not want to hold anybody's credential. The key
 * is stored in this browser only, sent with a request when the coach asks for a
 * summary, used once, and never written to disk on our side.
 *
 * The honest trade-off, stated on the config screen too: the key does pass
 * through our server on the way to Google. Calling Google straight from the
 * browser would keep it away from us entirely — but the prompt carries the
 * interpretation rules, and those are the one thing that must not reach the
 * client. Between leaking the rules and relaying a key we never store, relaying
 * is the smaller cost.
 */

const KEY = 'upcgm:ai:v1';

export interface AiConfig {
  apiKey: string;
  model: string;
  /** coach ticked the box saying they understand what leaves the machine */
  consented: boolean;
}

export const DEFAULT_MODEL = 'gemini-flash-latest';

export const EMPTY: AiConfig = { apiKey: '', model: DEFAULT_MODEL, consented: false };

const available = (): boolean => {
  try {
    localStorage.setItem('__upcgm_ai_probe__', '1');
    localStorage.removeItem('__upcgm_ai_probe__');
    return true;
  } catch {
    return false;
  }
};

export function loadAiConfig(): AiConfig {
  if (typeof window === 'undefined' || !available()) return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<AiConfig>;
    return {
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      model: typeof p.model === 'string' && p.model ? p.model : DEFAULT_MODEL,
      consented: p.consented === true,
    };
  } catch {
    return EMPTY;
  }
}

export function saveAiConfig(c: AiConfig): boolean {
  if (!available()) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
    return true;
  } catch {
    return false;
  }
}

export function clearAiConfig(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** AI is on only when there is a key AND the coach has ticked consent. */
export const aiEnabled = (c: AiConfig): boolean => c.apiKey.trim().length > 0 && c.consented;

/** Never print a key in full, not even to the person who pasted it. */
export function maskKey(k: string): string {
  const s = k.trim();
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}
