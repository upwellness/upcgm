'use client';

import { useMemo, useState } from 'react';
import { PATTERN_STYLE, type PatternKey } from '@/lib/bands';
import { fmtDuration } from '@/lib/time';
import type { Reading } from '@/lib/types';
import GlucoseChart from './GlucoseChart';
import { PatternChip, PatternGlyph } from './PatternPanel';
import { IconInfo } from './Icons';

/** Wire shape of CgmEvent from server/cgm/excursions.ts. */
export interface CgmEventView {
  id: string;
  t: number;
  source: 'marked' | 'detected';
  markerId: string | null;
  labelTh: string | null;
  overnight: boolean;
  whenTh: string;
  fromT: number;
  toT: number;
  pattern: {
    primary: PatternKey | null;
    also: PatternKey[];
    hits: { key: PatternKey; evidenceTh: string }[];
    noShape: 'thin-data' | 'between-shapes' | null;
    skippedReasonTh: string | null;
    metrics: {
      delta: number | null;
      minutesToPeak: number | null;
      minutesAboveBaseline: number | null;
      at180Delta: number | null;
      nadirAfterPeakDelta: number | null;
    };
  };
}

export interface EventSnapshotView {
  judged: number;
  thinData: number;
  betweenShapes: number;
  marked: number;
  detected: number;
  counts: Record<PatternKey, number>;
  dominant: PatternKey | null;
  headlineTh: string;
  firstMoveTh: string | null;
  overnightCount: number;
  crashNeedsPrescriber: boolean;
}

const ORDER: PatternKey[] = ['crash', 'stuck', 'spike', 'wide', 'flat'];

export default function EventExplorer({
  snap, events, readings,
}: {
  snap: EventSnapshotView;
  events: CgmEventView[];
  readings: Reading[];
}) {
  const [filter, setFilter] = useState<PatternKey | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const shown = useMemo(
    () => events.filter((e) => (filter === 'all' ? e.pattern.primary != null : e.pattern.primary === filter)),
    [events, filter],
  );
  const open = useMemo(() => events.find((e) => e.id === openId) ?? null, [events, openId]);

  // Only the slice the focus chart needs. Slicing here rather than passing the
  // whole wear keeps the SVG at a few dozen points instead of three thousand.
  const focusReadings = useMemo(() => {
    if (!open) return [];
    return readings.filter((r) => r.t >= open.fromT && r.t <= open.toT);
  }, [open, readings]);

  const total = ORDER.reduce((s, k) => s + (snap.counts[k] ?? 0), 0);

  return (
    <section className="glass rounded-lg p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="font-head text-[1.05rem] font-semibold">ช่วงที่น้ำตาลขึ้น — สแกนทั้งช่วงเวลา</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-[0.7rem] text-ink-40"
          title="คำว่า พุ่ง กว้าง ค้าง ตก เป็นคำที่ทีม UP Wellness ตั้งขึ้นเอง ไม่ใช่ศัพท์ทางการแพทย์ และเกณฑ์ที่ใช้แบ่งก็เป็นเกณฑ์ของทีมเอง">
          <IconInfo className="h-3 w-3" /> เกณฑ์ของเราเอง
        </span>
        <span className="num text-[0.76rem] text-ink-40">
          อ่านรูปร่างได้ {snap.judged} ช่วง
          {snap.marked > 0 && ` · จากมื้อที่บันทึก ${snap.marked}`}
          {snap.detected > 0 && ` · จากการสแกน ${snap.detected}`}
        </span>
      </div>

      <p className="mt-2 text-[0.92rem] font-medium leading-relaxed text-ink">{snap.headlineTh}</p>

      {snap.detected > 0 && (
        <p className="mt-2 rounded-sm bg-surface-sunken px-3 py-2 text-[0.82rem] leading-relaxed text-ink-70">
          <b className="text-ink">ช่วงที่มาจากการสแกนยืนยันไม่ได้ว่าเป็นอาหาร</b> — น้ำตาลขึ้นเองได้ตอนเช้ามืด
          ตอนป่วย ตอนเครียด และหลังออกกำลังกายหนัก · ถ้ารู้ว่ากินอะไร ให้กดเพิ่มมื้อทับลงไปเพื่อบันทึกชื่อไว้
          {snap.overnightCount > 0 && ` · มี ${snap.overnightCount} ช่วงเกิดตอน 00:00–06:00`}
        </p>
      )}

      {snap.crashNeedsPrescriber && (
        <p role="alert" className="mt-3 rounded-sm border-l-4 border-zone-vhigh bg-zone-vhigh/10 px-3 py-2 text-[0.86rem] leading-relaxed text-zone-vhigh-ink">
          <b>เจอรูปแบบ “ตก” ในเคสที่ใช้ยาลดน้ำตาลอยู่</b> — ส่งกราฟให้แพทย์ผู้สั่งยาดู ไม่ใช่เรื่องที่ปรับด้วยเมนูเอง
        </p>
      )}

      {total > 0 && (
        <>
          {/* the counts double as the filter — clicking a shape narrows the list */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => setFilter('all')}
              className={`min-h-[2.25rem] rounded-full px-3 py-1 text-[0.82rem] font-medium transition ${
                filter === 'all' ? 'bg-olive text-white' : 'bg-surface-sunken text-ink-70 hover:bg-white'}`}>
              ทั้งหมด {snap.judged}
            </button>
            {ORDER.filter((k) => (snap.counts[k] ?? 0) > 0).map((k) => {
              const s = PATTERN_STYLE[k];
              const on = filter === k;
              return (
                <button key={k} onClick={() => setFilter(k)}
                  className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full px-3 py-1 text-[0.82rem] font-medium transition"
                  style={on
                    ? { background: s.ink, color: '#fff' }
                    : { background: s.chip, color: s.ink }}>
                  <PatternGlyph k={k} className="h-3.5 w-[34px]" />
                  {s.labelTh} {snap.counts[k]}
                  {snap.dominant === k && <span className="text-[0.68rem] opacity-80">· บ่อยสุด</span>}
                </button>
              );
            })}
          </div>

          {snap.firstMoveTh && (
            <p className="mt-3 rounded-sm bg-surface-sunken px-3 py-2.5 text-[0.88rem] leading-relaxed">
              <span className="font-medium text-olive">แก้แบบเดียวก่อน · </span>{snap.firstMoveTh}
            </p>
          )}

          <ul className="mt-4 divide-y divide-line-soft">
            {shown.map((e) => {
              const isOpen = openId === e.id;
              const m = e.pattern.metrics;
              return (
                <li key={e.id}>
                  <button
                    onClick={() => setOpenId(isOpen ? null : e.id)}
                    aria-expanded={isOpen}
                    className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 py-3 text-left transition hover:bg-white/50"
                  >
                    {e.pattern.primary && <PatternChip k={e.pattern.primary} size="sm" />}
                    <span className="num text-[0.85rem] font-medium">{e.whenTh}</span>
                    {e.labelTh && <span className="text-[0.85rem]">{e.labelTh}</span>}
                    {e.source === 'detected' && (
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.68rem] text-ink-40">จากการสแกน</span>
                    )}
                    {e.overnight && (
                      <span className="rounded-full bg-zone-low/12 px-2 py-0.5 text-[0.68rem] text-zone-low-ink">กลางคืน</span>
                    )}
                    <span className="num ml-auto text-[0.85rem] font-semibold"
                      style={{ color: (m.delta ?? 0) > 60 ? '#946516' : '#367C4F' }}>
                      +{Math.round(m.delta ?? 0)}
                    </span>
                    <span className="text-[0.78rem] text-ink-40">{isOpen ? 'ย่อ ▲' : 'ดูกราฟ ▼'}</span>
                  </button>

                  {isOpen && open && (
                    <div className="pb-4">
                      <div className="rounded-md border border-line-soft bg-white/60 p-2">
                        <GlucoseChart
                          t={focusReadings.map((r) => r.t)}
                          v={focusReadings.map((r) => r.v)}
                          flag={focusReadings.map((r) => r.flag)}
                          from={open.fromT}
                          to={open.toT}
                          height={230}
                        />
                      </div>

                      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <Stat label="ขึ้นจากก่อนหน้า" value={m.delta != null ? `+${Math.round(m.delta)}` : '—'} unit="มก./ดล." />
                        <Stat label="ถึงยอดใน" value={m.minutesToPeak != null ? String(m.minutesToPeak) : '—'} unit="นาที" />
                        <Stat label="อยู่สูงกว่าเดิม" value={m.minutesAboveBaseline != null ? fmtDuration(m.minutesAboveBaseline) : '—'} unit="" />
                        <Stat label="ครบ 3 ชม. ต่างจากเดิม"
                          value={m.at180Delta != null ? `${m.at180Delta > 0 ? '+' : ''}${m.at180Delta}` : '—'} unit="มก./ดล." />
                        <Stat label="ต่ำสุดหลังยอด"
                          value={m.nadirAfterPeakDelta != null ? `${m.nadirAfterPeakDelta > 0 ? '+' : ''}${m.nadirAfterPeakDelta}` : '—'} unit="มก./ดล. เทียบก่อนขึ้น" />
                        <Stat label="ที่มาของช่วงนี้" value={e.source === 'marked' ? 'โค้ชบันทึก' : 'สแกนเจอ'} unit="" />
                      </dl>

                      {e.pattern.hits.length > 0 && (
                        <ul className="mt-3 space-y-1.5">
                          {e.pattern.hits.map((h) => (
                            <li key={h.key} className="flex flex-wrap items-center gap-2 text-[0.83rem]">
                              <PatternChip k={h.key} size="sm" />
                              <span className="num text-ink-70">{h.evidenceTh}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {e.pattern.skippedReasonTh && (
                        <p className="num mt-3 text-[0.83rem] text-ink-40">{e.pattern.skippedReasonTh}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {shown.length === 0 && (
            <p className="mt-4 text-[0.85rem] text-ink-40">ไม่มีช่วงที่เข้าเกณฑ์รูปร่างนี้</p>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-sm bg-surface-sunken px-3 py-2">
      <dt className="text-[0.72rem] text-ink-40">{label}</dt>
      <dd className="num text-[0.98rem] font-semibold">
        {value} {unit && <span className="text-[0.7rem] font-normal text-ink-40">{unit}</span>}
      </dd>
    </div>
  );
}
