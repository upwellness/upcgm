import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/ai/route';
import { analyse } from '@/server/cgm/analyse';
import { makeWorkbook, series, flat } from './helpers';
import { aiEnabled, maskKey, DEFAULT_MODEL, EMPTY } from '@/lib/ai-config';

/**
 * The promise this feature makes: with no key the tool is fully usable and
 * nothing about the client leaves the machine. That is a promise about network
 * calls, so it is tested by watching fetch, not by reading the code.
 */

const result = analyse(
  makeWorkbook(series({ y: 2026, mo: 7, d: 12, h: 0, mi: 0 }, flat(110, 288 * 3))),
  'a.xlsx',
);

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
afterEach(() => { fetchSpy.mockRestore(); });

describe('no key means no call', () => {
  it('returns every finding without contacting anybody', async () => {
    const res = await post({ result, meds: 'no' });
    const j = await res.json();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(j.interpretation.findings.length).toBeGreaterThan(0);
    expect(j.interpretation.eventSnapshot).toBeTruthy();
    expect(j.narrative).toBeNull();
  });

  it('does not call out just because the chart was re-ranged, even with a key', async () => {
    // wantNarrative is false: this is the request that fires on every window change
    const res = await post({ result, meds: 'no', aiKey: 'AIza-test-key-1234567890', wantNarrative: false });
    await res.json();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('explains where to turn AI on when the coach asks for it without a key', async () => {
    const res = await post({ result, meds: 'no', wantNarrative: true });
    const j = await res.json();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(j.reasonTh).toContain('ตั้งค่า');
    expect(j.interpretation.findings.length).toBeGreaterThan(0);
  });
});

describe('with a key, only when asked', () => {
  it('calls Gemini with the coach’s model and sends no raw readings', async () => {
    fetchSpy.mockResolvedValue(new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'สรุปทดสอบ' }] } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ) as Response);

    const res = await post({
      result, meds: 'no', wantNarrative: true,
      aiKey: 'AIza-test-key-1234567890', aiModel: 'gemini-flash-latest',
    });
    const j = await res.json();
    expect(j.narrative).toBe('สรุปทดสอบ');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('generativelanguage.googleapis.com');
    expect(String(url)).toContain('gemini-flash-latest');

    // The whole point of the consent line on the config screen: aggregates go,
    // the 864-point series does not.
    const sent = String(init.body);
    expect(sent).not.toContain('"series"');
    expect(sent.length).toBeLessThan(20_000);
  });

  it('passes Google’s own error through instead of a shrug', async () => {
    fetchSpy.mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ) as Response);

    const j = await (await post({
      result, meds: 'no', wantNarrative: true, aiKey: 'bad-key-but-long-enough',
    })).json();
    expect(j.narrative).toBeNull();
    expect(j.reasonTh).toContain('API key not valid');
    // findings survive a failed model call
    expect(j.interpretation.findings.length).toBeGreaterThan(0);
  });

  it('drops a narrative that strays out of scope, keeping the findings', async () => {
    fetchSpy.mockResolvedValue(new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'แนะนำให้ปรับยาเบาหวานเป็นสองเท่า' }] } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ) as Response);

    const j = await (await post({
      result, meds: 'no', wantNarrative: true, aiKey: 'AIza-test-key-1234567890',
    })).json();
    expect(j.narrative).toBeNull();
    expect(j.reasonTh).toContain('นอกขอบเขต');
    expect(j.interpretation.findings.length).toBeGreaterThan(0);
  });
});

describe('the key itself', () => {
  it('is off until there is a key AND the coach ticked consent', () => {
    expect(aiEnabled(EMPTY)).toBe(false);
    expect(aiEnabled({ apiKey: 'AIza-1234567890', model: DEFAULT_MODEL, consented: false })).toBe(false);
    expect(aiEnabled({ apiKey: '   ', model: DEFAULT_MODEL, consented: true })).toBe(false);
    expect(aiEnabled({ apiKey: 'AIza-1234567890', model: DEFAULT_MODEL, consented: true })).toBe(true);
  });

  it('is never shown in full, not even back to the person who pasted it', () => {
    const k = 'AIzaSyD-EXAMPLE-1234567890abcdef';
    const masked = maskKey(k);
    expect(masked).not.toBe(k);
    expect(masked).toContain('••');
    expect(masked.length).toBeLessThan(k.length);
  });
});
