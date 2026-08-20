'use client';

import { useMemo, useRef, useState } from 'react';
import { usePrefs, useT } from './PrefsProvider';
import { MEAL_KINDS, label, type PatternKey } from '@/lib/bands';
import { mealResponse } from '@/lib/meal-response';
import { fmtDateTime, fmtDuration, toLocalInputValue, fromLocalInputValue } from '@/lib/time';
import { fromFile, newId, toFile } from '@/lib/markers-store';
import type { MealMarker, Reading } from '@/lib/types';
import { IconDownload, IconPlus, IconTrash, IconUpload } from './Icons';
import { PatternChip } from './PatternPanel';

/** Wire shape of MealPattern from server/cgm/patterns.ts — verdict only. */
export interface MealPatternView {
  markerId: string;
  primary: PatternKey | null;
  also: PatternKey[];
  hits: { key: PatternKey; evidenceTh: string }[];
  noShape: 'thin-data' | 'between-shapes' | null;
  skippedReasonTh: string | null;
}

/** Same house cutoff used for the headline delta — kept in one place so the
 * per-checkpoint colors below always agree with it. */
const deltaColor = (d: number) => (d > 60 ? 'rgb(var(--c-zone-high-ink))' : 'rgb(var(--c-zone-in-ink))');

const PATTERN_LABEL: Record<PatternKey, string> = {
  spike: 'พุ่ง', wide: 'กว้าง', stuck: 'ค้าง', crash: 'ตก', flat: 'เรียบ',
};

const checkpointLabel = (t: (a: string, b: string) => string): Record<number, string> =>
  ({ 60: t('1 ชม.', '1h'), 120: t('2 ชม.', '2h'), 180: t('3 ชม.', '3h') });

interface Props {
  datasetId: string;
  sourceName: string;
  readings: Reading[];
  markers: MealMarker[];
  onChange: (next: MealMarker[]) => void;
  /** default time for a new marker — the middle of the visible window */
  defaultT: number;
  storageWorks: boolean;
  /** shape verdicts, computed on the server; empty until the first reply lands */
  perMeal: MealPatternView[];
}

export default function MealPanel({ datasetId, sourceName, readings, markers, onChange, defaultT, storageWorks, perMeal }: Props) {
  const t = useT();
  const { prefs: { locale } } = usePrefs();
  const [draft, setDraft] = useState<MealMarker | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const responses = useMemo(
    () => new Map(markers.map((m) => [m.id, mealResponse(m.id, m.t, readings)])),
    [markers, readings],
  );
  const shapes = useMemo(() => new Map(perMeal.map((p) => [p.markerId, p])), [perMeal]);

  function startNew() {
    setDraft({
      id: newId(),
      t: Math.round(defaultT),
      label: '',
      kind: 'lunch',
      eatingOrder: 'unknown',
      walkedAfter: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  function commit() {
    if (!draft) return;
    const label = draft.label.trim();
    if (!label) {
      setNotice({ tone: 'warn', text: t('ใส่ชื่อมื้อสั้น ๆ ก่อน เช่น “ข้าวมันไก่” — ไว้เทียบกันคราวหลัง', 'Give the meal a short name first, e.g. “chicken rice” — so it can be compared next time.') });
      return;
    }
    const next = [...markers.filter((m) => m.id !== draft.id), { ...draft, label, updatedAt: Date.now() }]
      .sort((a, b) => a.t - b.t);
    onChange(next);
    setDraft(null);
    setNotice({ tone: 'ok', text: t(`บันทึก “${label}” แล้ว — จดจำอัตโนมัติในเครื่องนี้ ไม่ต้องกดซ้ำ`, `Saved “${label}” — remembered on this device automatically, no need to save again.`) });
  }

  function remove(id: string) {
    onChange(markers.filter((m) => m.id !== id));
  }

  function download() {
    const blob = new Blob([JSON.stringify(toFile(datasetId, sourceName, markers), null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `upcgm-meals-${datasetId}.json`;
    a.click();
    // Revoking immediately cancels the download in Safari; one tick is enough.
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function upload(f: File) {
    const text = await f.text();
    const res = fromFile(text, datasetId);
    if (!res.ok) {
      setNotice({ tone: 'warn', text: res.errorTh ?? t('อ่านไฟล์ไม่ได้', 'Could not read the file.') });
      return;
    }
    if (res.mismatch) {
      const go = window.confirm(
        t('ไฟล์มื้ออาหารนี้มาจากไฟล์ CGM ชุดอื่น\n\nถ้าเป็นคนเดียวกันและส่งออกใหม่ก็โหลดต่อได้ แต่ถ้าเป็นเคสอื่น มื้ออาหารจะไปทับกราฟผิดคน\n\nยืนยันโหลดต่อ?', 'This meal file came from a different CGM export.\n\nIf it is the same person re-exported, loading is fine. If it is a different client, the meals will land on the wrong chart.\n\nLoad anyway?'),
      );
      if (!go) return;
    }
    onChange(res.markers);
    setNotice({ tone: 'ok', text: t(`โหลดมื้ออาหาร ${res.markers.length} รายการเรียบร้อย`, `Loaded ${res.markers.length} meals.`) });
  }

  return (
    <section className="glass rounded-lg p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-head text-[1.05rem] font-semibold">{t('มื้ออาหารที่บันทึกไว้', 'Logged meals')}</h2>
        <span className="num rounded-full bg-surface-sunken px-2.5 py-0.5 text-[0.78rem] text-ink-70">
          {t(`${markers.length} มื้อ`, `${markers.length} ${markers.length === 1 ? 'meal' : 'meals'}`)}
        </span>
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          <button onClick={startNew}
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-[0.85rem] font-medium text-accent-ink transition hover:bg-accent-dark sm:flex-none">
            <IconPlus className="h-3.5 w-3.5" /> {t('เพิ่มมื้อ', 'Add meal')}
          </button>
          <button onClick={download} disabled={markers.length === 0}
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-sm border border-line px-3 py-2 text-[0.85rem] transition hover:bg-surface-raised disabled:opacity-40 sm:flex-none">
            <IconDownload className="h-3.5 w-3.5" /> {t('บันทึกเป็นไฟล์', 'Save to file')}
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-sm border border-line px-3 py-2 text-[0.85rem] transition hover:bg-surface-raised sm:flex-none">
            <IconUpload className="h-3.5 w-3.5" /> {t('โหลดจากไฟล์', 'Load from file')}
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Reset first: picking the same file twice in a row fires no change
              // event otherwise, and it looks like the button stopped working.
              e.target.value = '';
              if (f) void upload(f);
            }} />
        </div>
      </div>

      <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-40">
        {storageWorks
          ? t('มื้ออาหารเก็บอยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น ไม่ได้ส่งขึ้นเซิร์ฟเวอร์ — เปิดไฟล์เดิมอีกครั้งจะขึ้นให้เอง ถ้าจะย้ายเครื่องให้กดบันทึกเป็นไฟล์', 'Meals stay in this browser and are never sent to a server. Reopen the same file and they come back. To move them to another device, save them to a file.')
            : t('เบราว์เซอร์นี้ไม่ให้เก็บข้อมูลในเครื่อง (อาจอยู่ในโหมดส่วนตัว) — มื้ออาหารจะหายเมื่อปิดหน้านี้ ให้กดบันทึกเป็นไฟล์ไว้', 'This browser will not store data locally (private mode, most likely) — meals will be lost when this page closes. Save them to a file.')}
      </p>

      {notice && (
        <p role="status" className={`mt-3 rounded-sm px-3 py-2 text-[0.85rem] ${
          notice.tone === 'ok' ? 'bg-zone-in/10 text-zone-in-ink' : 'bg-zone-high/12 text-zone-high-ink'}`}>
          {notice.text}
        </p>
      )}

      {draft && (
        <div className="mt-4 rounded-md border border-olive/25 bg-surface-raised/70 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[0.83rem] font-medium">{t('ชื่อมื้อ', 'Meal name')}</span>
              <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder={t('เช่น ข้าวมันไก่ / ก๋วยเตี๋ยวต้มยำ', 'e.g. chicken rice / tom yum noodles')}
                maxLength={60} autoFocus
                className="mt-1 w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.92rem] outline-none focus:border-olive" />
            </label>
            <label className="block">
              <span className="text-[0.83rem] font-medium">{t('เวลาที่เริ่มกิน', 'Time eating started')}</span>
              <input type="datetime-local" value={toLocalInputValue(draft.t)}
                onChange={(e) => {
                  const t = fromLocalInputValue(e.target.value);
                  if (t != null) setDraft({ ...draft, t });
                }}
                className="num mt-1 w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.92rem] outline-none focus:border-olive" />
            </label>
            <label className="block">
              <span className="text-[0.83rem] font-medium">{t('ประเภท', 'Type')}</span>
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as MealMarker['kind'] })}
                className="mt-1 w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.92rem] outline-none focus:border-olive">
                {MEAL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.glyph} {label(k, locale)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[0.83rem] font-medium">{t('ลำดับการกิน', 'Eating order')}</span>
              <select value={draft.eatingOrder ?? 'unknown'}
                onChange={(e) => setDraft({ ...draft, eatingOrder: e.target.value as MealMarker['eatingOrder'] })}
                className="mt-1 w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.92rem] outline-none focus:border-olive">
                <option value="unknown">{t('ไม่ได้สังเกต', 'Not noted')}</option>
                <option value="veg-first">{t('กินผัก/โปรตีนก่อนคาร์บ', 'Vegetables/protein before carbs')}</option>
                <option value="carb-first">{t('กินคาร์บก่อน', 'Carbs first')}</option>
              </select>
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[0.88rem]">
            <input type="checkbox" checked={draft.walkedAfter ?? false}
              onChange={(e) => setDraft({ ...draft, walkedAfter: e.target.checked })}
              className="h-4 w-4 rounded border-line accent-olive" />
            {t('เดินหลังมื้อนี้ 10 นาทีขึ้นไป', 'Walked 10 minutes or more after this meal')}
          </label>
          <div className="mt-4 flex gap-2">
            <button onClick={commit}
              className="min-h-[2.75rem] flex-1 rounded-sm bg-accent px-4 py-2 text-[0.88rem] sm:flex-none font-medium text-accent-ink transition hover:bg-accent-dark">
              {t('บันทึกมื้อนี้', 'Save this meal')}
            </button>
            <button onClick={() => { setDraft(null); setNotice(null); }}
              className="min-h-[2.75rem] flex-1 rounded-sm border border-line px-4 py-2 text-[0.88rem] sm:flex-none transition hover:bg-surface-raised">
              {t('ยกเลิก', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {markers.length > 0 && (
        <ul className="mt-4 divide-y divide-line-soft">
          {markers.map((m) => {
            const r = responses.get(m.id);
            const shape = shapes.get(m.id);
            const kind = MEAL_KINDS.find((k) => k.key === m.kind);
            return (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span aria-hidden="true">{kind?.glyph}</span>
                  <span className="font-medium">{m.label}</span>
                  <span className="num text-[0.8rem] text-ink-40">{fmtDateTime(m.t)}</span>
                  {shape?.primary && <PatternChip k={shape.primary} size="sm" />}
                  {!shape && (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.7rem] text-ink-40"
                      title={t('มื้อนี้อยู่นอกช่วงเวลาที่เลือกอยู่ จึงไม่ถูกนำมาวิเคราะห์รูปร่าง', 'This meal sits outside the selected window, so its shape was not analysed.')}>
                      {t('นอกช่วงที่เลือก', 'outside the window')}
                    </span>
                  )}
                  {shape && !shape.primary && (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.7rem] text-ink-40"
                      title={shape.skippedReasonTh ?? ''}>
                      {shape.noShape === 'thin-data' ? t('ข้อมูลไม่พอ', 'not enough data') : t('อยู่กลาง ๆ ระหว่างแบบ', 'between shapes')}
                    </span>
                  )}
                  {shape?.also.map((k) => (
                    <span key={k} className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.7rem] text-ink-40">
                      + {PATTERN_LABEL[k]}
                    </span>
                  ))}
                  {m.eatingOrder === 'veg-first' && (
                    <span className="rounded-full bg-zone-in/12 px-2 py-0.5 text-[0.72rem] text-zone-in-ink">{t('ผักก่อน', 'veg first')}</span>
                  )}
                  {m.walkedAfter && (
                    <span className="rounded-full bg-zone-in/12 px-2 py-0.5 text-[0.72rem] text-zone-in-ink">{t('เดินหลังมื้อ', 'walked after')}</span>
                  )}
                  <button onClick={() => remove(m.id)} aria-label={t(`ลบมื้อ ${m.label}`, `Delete meal ${m.label}`)}
                    className="ml-auto rounded-sm p-2 text-ink-40 transition hover:bg-zone-vhigh/10 hover:text-zone-vhigh-ink">
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
                <div className="num mt-1 text-[0.82rem] sm:text-[0.85rem]">
                  {r?.delta != null ? (
                    <>
                      <span className="font-semibold" style={{ color: deltaColor(r.delta) }}>
                        +{Math.round(r.delta)}
                      </span>
                      <span className="text-ink-40">
                        {' '}{t(`มก./ดล. · สูงสุดใน ${r.minutesToPeak} นาที`, `mg/dL · peak in ${r.minutesToPeak} min`)}
                        {r.minutesToBaseline != null ? t(` · กลับที่เดิม ${fmtDuration(r.minutesToBaseline, locale)}`, ` · back to baseline in ${fmtDuration(r.minutesToBaseline, locale)}`) : t(' · ยังไม่กลับที่เดิมใน 3 ชม.', ' · had not returned to baseline within 3h')}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-40">{t('ไม่มีข้อมูลน้ำตาลพอในช่วง 3 ชั่วโมงหลังมื้อนี้', 'Not enough glucose data in the 3 hours after this meal')}</span>
                  )}
                </div>
                {r && r.checkpoints.some((c) => c.value != null) && (
                  <details className="mt-2 rounded-sm border border-line-soft bg-surface-raised/50">
                    <summary className="cursor-pointer select-none px-3 py-2 text-[0.78rem] font-medium text-ink-70">
                      {t('ดูค่าที่ 1 / 2 / 3 ชั่วโมงหลังมื้อ', 'See the 1 / 2 / 3-hour marks after the meal')}
                    </summary>
                    <div className="grid grid-cols-3 gap-2 px-3 pb-3 pt-1">
                      {r.checkpoints.map((c) => (
                        <div key={c.minutes} className="num rounded-sm bg-surface-sunken px-2 py-1.5 text-center">
                          <div className="text-[0.72rem] text-ink-40">{checkpointLabel(t)[c.minutes]}</div>
                          {c.value != null ? (
                            <>
                              <div className="text-[0.95rem] font-semibold">{c.value}</div>
                              <div className="text-[0.72rem]" style={{ color: deltaColor(c.delta ?? 0) }}>
                                {(c.delta ?? 0) > 0 ? '+' : ''}{c.delta}
                              </div>
                            </>
                          ) : (
                            <div className="mt-1 text-[0.72rem] text-ink-40">{t('ไม่มีข้อมูล', 'no data')}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
