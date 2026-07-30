'use client';

import { useMemo, useRef, useState } from 'react';
import { MEAL_KINDS } from '@/lib/bands';
import { mealResponse } from '@/lib/meal-response';
import { fmtDateTime, fmtDuration, toLocalInputValue, fromLocalInputValue } from '@/lib/time';
import { fromFile, newId, toFile } from '@/lib/markers-store';
import type { MealMarker, Reading } from '@/lib/types';
import { IconDownload, IconPlus, IconTrash, IconUpload } from './Icons';

interface Props {
  datasetId: string;
  sourceName: string;
  readings: Reading[];
  markers: MealMarker[];
  onChange: (next: MealMarker[]) => void;
  /** default time for a new marker — the middle of the visible window */
  defaultT: number;
  storageWorks: boolean;
}

export default function MealPanel({ datasetId, sourceName, readings, markers, onChange, defaultT, storageWorks }: Props) {
  const [draft, setDraft] = useState<MealMarker | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const responses = useMemo(
    () => new Map(markers.map((m) => [m.id, mealResponse(m.id, m.t, readings)])),
    [markers, readings],
  );

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
      setNotice({ tone: 'warn', text: 'ใส่ชื่อมื้อสั้น ๆ ก่อน เช่น “ข้าวมันไก่” — ไว้เทียบกันคราวหลัง' });
      return;
    }
    const next = [...markers.filter((m) => m.id !== draft.id), { ...draft, label, updatedAt: Date.now() }]
      .sort((a, b) => a.t - b.t);
    onChange(next);
    setDraft(null);
    setNotice(null);
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
      setNotice({ tone: 'warn', text: res.errorTh ?? 'อ่านไฟล์ไม่ได้' });
      return;
    }
    if (res.mismatch) {
      const go = window.confirm(
        'ไฟล์มื้ออาหารนี้มาจากไฟล์ CGM ชุดอื่น\n\nถ้าเป็นคนเดียวกันและส่งออกใหม่ก็โหลดต่อได้ แต่ถ้าเป็นเคสอื่น มื้ออาหารจะไปทับกราฟผิดคน\n\nยืนยันโหลดต่อ?',
      );
      if (!go) return;
    }
    onChange(res.markers);
    setNotice({ tone: 'ok', text: `โหลดมื้ออาหาร ${res.markers.length} รายการเรียบร้อย` });
  }

  return (
    <section className="glass rounded-lg p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-head text-[1.05rem] font-semibold">มื้ออาหารที่บันทึกไว้</h2>
        <span className="num rounded-full bg-surface-sunken px-2.5 py-0.5 text-[0.78rem] text-ink-70">
          {markers.length} มื้อ
        </span>
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          <button onClick={startNew}
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-sm bg-olive px-3 py-2 text-[0.85rem] font-medium text-white transition hover:bg-olive-dark sm:flex-none">
            <IconPlus className="h-3.5 w-3.5" /> เพิ่มมื้อ
          </button>
          <button onClick={download} disabled={markers.length === 0}
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-sm border border-line px-3 py-2 text-[0.85rem] transition hover:bg-white disabled:opacity-40 sm:flex-none">
            <IconDownload className="h-3.5 w-3.5" /> บันทึกเป็นไฟล์
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-sm border border-line px-3 py-2 text-[0.85rem] transition hover:bg-white sm:flex-none">
            <IconUpload className="h-3.5 w-3.5" /> โหลดจากไฟล์
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
          ? 'มื้ออาหารเก็บอยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น ไม่ได้ส่งขึ้นเซิร์ฟเวอร์ — เปิดไฟล์เดิมอีกครั้งจะขึ้นให้เอง ถ้าจะย้ายเครื่องให้กดบันทึกเป็นไฟล์'
          : 'เบราว์เซอร์นี้ไม่ให้เก็บข้อมูลในเครื่อง (อาจอยู่ในโหมดส่วนตัว) — มื้ออาหารจะหายเมื่อปิดหน้านี้ ให้กดบันทึกเป็นไฟล์ไว้'}
      </p>

      {notice && (
        <p role="status" className={`mt-3 rounded-sm px-3 py-2 text-[0.85rem] ${
          notice.tone === 'ok' ? 'bg-zone-in/10 text-zone-in-ink' : 'bg-zone-high/12 text-zone-high-ink'}`}>
          {notice.text}
        </p>
      )}

      {draft && (
        <div className="mt-4 rounded-md border border-olive/25 bg-white/70 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[0.83rem] font-medium">ชื่อมื้อ</span>
              <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="เช่น ข้าวมันไก่ / ก๋วยเตี๋ยวต้มยำ"
                maxLength={60} autoFocus
                className="mt-1 w-full rounded-sm border border-line bg-white px-3 py-2 text-[0.92rem] outline-none focus:border-olive" />
            </label>
            <label className="block">
              <span className="text-[0.83rem] font-medium">เวลาที่เริ่มกิน</span>
              <input type="datetime-local" value={toLocalInputValue(draft.t)}
                onChange={(e) => {
                  const t = fromLocalInputValue(e.target.value);
                  if (t != null) setDraft({ ...draft, t });
                }}
                className="num mt-1 w-full rounded-sm border border-line bg-white px-3 py-2 text-[0.92rem] outline-none focus:border-olive" />
            </label>
            <label className="block">
              <span className="text-[0.83rem] font-medium">ประเภท</span>
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as MealMarker['kind'] })}
                className="mt-1 w-full rounded-sm border border-line bg-white px-3 py-2 text-[0.92rem] outline-none focus:border-olive">
                {MEAL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.glyph} {k.labelTh}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[0.83rem] font-medium">ลำดับการกิน</span>
              <select value={draft.eatingOrder ?? 'unknown'}
                onChange={(e) => setDraft({ ...draft, eatingOrder: e.target.value as MealMarker['eatingOrder'] })}
                className="mt-1 w-full rounded-sm border border-line bg-white px-3 py-2 text-[0.92rem] outline-none focus:border-olive">
                <option value="unknown">ไม่ได้สังเกต</option>
                <option value="veg-first">กินผัก/โปรตีนก่อนคาร์บ</option>
                <option value="carb-first">กินคาร์บก่อน</option>
              </select>
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[0.88rem]">
            <input type="checkbox" checked={draft.walkedAfter ?? false}
              onChange={(e) => setDraft({ ...draft, walkedAfter: e.target.checked })}
              className="h-4 w-4 rounded border-line accent-olive" />
            เดินหลังมื้อนี้ 10 นาทีขึ้นไป
          </label>
          <div className="mt-4 flex gap-2">
            <button onClick={commit}
              className="min-h-[2.75rem] flex-1 rounded-sm bg-olive px-4 py-2 text-[0.88rem] sm:flex-none font-medium text-white transition hover:bg-olive-dark">
              บันทึกมื้อนี้
            </button>
            <button onClick={() => { setDraft(null); setNotice(null); }}
              className="min-h-[2.75rem] flex-1 rounded-sm border border-line px-4 py-2 text-[0.88rem] sm:flex-none transition hover:bg-white">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {markers.length > 0 && (
        <ul className="mt-4 divide-y divide-line-soft">
          {markers.map((m) => {
            const r = responses.get(m.id);
            const kind = MEAL_KINDS.find((k) => k.key === m.kind);
            return (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span aria-hidden="true">{kind?.glyph}</span>
                  <span className="font-medium">{m.label}</span>
                  <span className="num text-[0.8rem] text-ink-40">{fmtDateTime(m.t)}</span>
                  {m.eatingOrder === 'veg-first' && (
                    <span className="rounded-full bg-zone-in/12 px-2 py-0.5 text-[0.72rem] text-zone-in-ink">ผักก่อน</span>
                  )}
                  {m.walkedAfter && (
                    <span className="rounded-full bg-zone-in/12 px-2 py-0.5 text-[0.72rem] text-zone-in-ink">เดินหลังมื้อ</span>
                  )}
                  <button onClick={() => remove(m.id)} aria-label={`ลบมื้อ ${m.label}`}
                    className="ml-auto rounded-sm p-2 text-ink-40 transition hover:bg-zone-vhigh/10 hover:text-zone-vhigh-ink">
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
                <div className="num mt-1 text-[0.82rem] sm:text-[0.85rem]">
                  {r?.delta != null ? (
                    <>
                      <span className="font-semibold" style={{ color: r.delta > 60 ? '#946516' : '#367C4F' }}>
                        +{Math.round(r.delta)}
                      </span>
                      <span className="text-ink-40">
                        {' '}มก./ดล. · สูงสุดใน {r.minutesToPeak} นาที
                        {r.minutesToBaseline != null ? ` · กลับที่เดิม ${fmtDuration(r.minutesToBaseline)}` : ' · ยังไม่กลับที่เดิมใน 3 ชม.'}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-40">ไม่มีข้อมูลน้ำตาลพอในช่วง 3 ชั่วโมงหลังมื้อนี้</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
