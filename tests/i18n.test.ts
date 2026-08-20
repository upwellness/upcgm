import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/ai/route';
import { analyse } from '@/server/cgm/analyse';
import { interpret } from '@/server/cgm/interpret';
import { gateForWindow } from '@/server/cgm/thresholds';
import { patternDefs, patternRuleNote } from '@/server/cgm/patterns';
import { buildEvents } from '@/server/cgm/excursions';
import { BANDS, MEAL_KINDS, PATTERN_STYLE, SEVERITY_STYLE, label } from '@/lib/bands';
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

  /**
   * The sweep above only reaches strings the *server* composes. Half the words
   * on screen come from lookup tables in lib/bands.ts that components read
   * directly — and for one release every one of them printed Thai in an English
   * session, because nothing here looked at them.
   */
  it('leaves no Thai in the lookup tables the components read directly', () => {
    const tables: [string, { labelTh: string; labelEn: string }[]][] = [
      ['BANDS', BANDS],
      ['SEVERITY_STYLE', Object.values(SEVERITY_STYLE)],
      ['PATTERN_STYLE', Object.values(PATTERN_STYLE)],
      ['MEAL_KINDS', [...MEAL_KINDS]],
    ];
    for (const [name, rows] of tables) {
      expect(rows.length, name).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.labelEn, `${name}: "${row.labelTh}" has no English half`).toBeTruthy();
        expect(thai.test(label(row, 'en')), `${name}: "${row.labelEn}" is not English`).toBe(false);
        expect(thai.test(label(row, 'th')), `${name}: "${row.labelTh}" is not Thai`).toBe(true);
      }
    }
  });

  /**
   * Dates were the last Thai left on an English screen: every event timestamp
   * went through fmtThaiDate regardless of who was reading, and the finding
   * that names the strongest rise carries one inside an English sentence.
   * The Buddhist year is the tell — 2569 sitting next to English prose.
   */
  it('dates an event in the reader\u2019s calendar, not always the Thai one', () => {
    // a flat line with one meal-sized rise, so there is an event to date at all
    const values = [
      ...Array.from({ length: 72 }, () => 100),
      ...[110, 140, 175, 190, 185, 165, 140, 120, 108],
      ...Array.from({ length: 72 }, () => 100),
    ];
    const readings = values.map((v, i) => ({ t: Date.UTC(2026, 6, 12, 6, 0) / 60000 + i * 5, v, flag: 'ok' as const }));

    const en = buildEvents(readings, [], undefined, 'en');
    const th = buildEvents(readings, [], undefined, 'th');
    expect(en.length, 'no event was detected, so nothing was dated').toBeGreaterThan(0);
    for (const e of en) expect(thai.test(e.whenTh), `English build dated an event "${e.whenTh}"`).toBe(false);
    for (const e of th) expect(thai.test(e.whenTh), `Thai build dated an event "${e.whenTh}"`).toBe(true);
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
