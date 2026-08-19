import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/ai/route';
import { analyse } from '@/server/cgm/analyse';
import { interpret } from '@/server/cgm/interpret';
import { gateForWindow } from '@/server/cgm/thresholds';
import { patternDefs, patternRuleNote } from '@/server/cgm/patterns';
import { makeWorkbook, series, flat } from './helpers';

/**
 * The promise this feature makes is not "there is a dictionary" — it is that a
 * coach who picks English never sees a Thai clinical sentence, and that the
 * safety guard on the model still holds in the language it answered in.
 */

const thai = /[฀-๿]/;

const build = (locale: 'th' | 'en') =>
  analyse(makeWorkbook(series({ y: 2026, mo: 7, d: 12, h: 0, mi: 0 }, flat(110, 288 * 16))), 'a.xlsx', locale);

describe('English really is English', () => {
  it('leaves no Thai in anything the screen prints', () => {
    const result = build('en');
    const out = interpret(result, { meds: 'no', locale: 'en' });

    const strings = [
      out.headlineTh,
      ...out.limitationsTh,
      ...out.findings.flatMap((f) => [f.titleTh, f.evidenceTh, f.actionTh ?? '']),
      ...out.agpNotes.flatMap((n) => [n.titleTh, n.bodyTh]),
      out.eventSnapshot.headlineTh,
      ...result.windows.flatMap((w) => [w.labelTh, w.gate.noteTh ?? '']),
      ...(result.metrics?.buckets ?? []).map((b) => b.labelTh),
    ].filter(Boolean);

    expect(strings.length).toBeGreaterThan(10);
    const leaked = strings.filter((s) => thai.test(s));
    expect(leaked, `Thai leaked into the English build:\n${leaked.join('\n')}`).toEqual([]);
  });

  it('still speaks Thai when Thai is asked for', () => {
    const out = interpret(build('th'), { meds: 'no', locale: 'th' });
    expect(thai.test(out.headlineTh)).toBe(true);
  });

  it('translates the shape names and the rule note that explains them', () => {
    expect(patternDefs('en').stuck.labelTh).toBe('Stuck');
    expect(patternDefs('th').stuck.labelTh).toBe('ค้าง');
    expect(thai.test(patternRuleNote('en'))).toBe(false);
    // the thresholds themselves must survive translation
    expect(patternRuleNote('en')).toContain('3-hour mark');
  });

  it('translates the data-quality gate, which is the caveat on every number', () => {
    expect(thai.test(gateForWindow(0.2, 100, 'en').noteTh!)).toBe(false);
    expect(thai.test(gateForWindow(0.2, 100, 'th').noteTh!)).toBe(true);
    // and keeps the gate itself identical in both
    expect(gateForWindow(5, 90, 'en').showGmi).toBe(gateForWindow(5, 90, 'th').showGmi);
  });
});

describe('the safety guard is not language-specific', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => { fetchSpy.mockRestore(); });

  const post = (body: unknown) =>
    POST(new Request('http://localhost/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));

  const reply = (text: string) =>
    fetchSpy.mockResolvedValue(new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ) as Response);

  const result = build('en');

  it.each([
    'You should increase your dose of metformin next week.',
    'This is enough to diagnose diabetes.',
    'Ask about our supplements to help with this.',
  ])('drops an English answer that strays out of scope: %s', async (text) => {
    reply(text);
    const j = await (await post({
      result, meds: 'no', locale: 'en', wantNarrative: true, aiKey: 'AIza-test-key-1234567890',
    })).json();
    expect(j.narrative).toBeNull();
    expect(j.interpretation.findings.length).toBeGreaterThan(0);
  });

  it('keeps an English answer that stays on behaviour', async () => {
    reply('Your average sits at 110 mg/dL and the swing is small.\n\nTry a ten minute walk after dinner this week.');
    const j = await (await post({
      result, meds: 'no', locale: 'en', wantNarrative: true, aiKey: 'AIza-test-key-1234567890',
    })).json();
    expect(j.narrative).toContain('walk after dinner');
  });

  it('still catches a Thai answer even when English was requested', async () => {
    reply('แนะนำให้ปรับยาเบาหวานเป็นสองเท่า');
    const j = await (await post({
      result, meds: 'no', locale: 'en', wantNarrative: true, aiKey: 'AIza-test-key-1234567890',
    })).json();
    expect(j.narrative).toBeNull();
  });
});
