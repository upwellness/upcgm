'use client';

import { PATTERN_STYLE, label, type PatternKey } from '@/lib/bands';
import { usePrefs, useT } from './PrefsProvider';
import { IconInfo } from './Icons';

/** Mirror of PatternSnapshot in server/cgm/patterns.ts — the wire shape only. */
export interface PatternSnapshotView {
  judged: number;
  thinData: number;
  betweenShapes: number;
  counts: Record<PatternKey, number>;
  dominant: PatternKey | null;
  headlineTh: string;
  linesTh: string[];
  firstMoveTh: string | null;
  examples: { markerId: string; labelTh: string; whenTh: string; patternTh: string; evidenceTh: string }[];
  crashNeedsPrescriber: boolean;
}

/** The little curve sketch. Same four shapes the teaching deck draws. */
export function PatternGlyph({ k, className = 'h-5 w-[60px]' }: { k: PatternKey; className?: string }) {
  const s = PATTERN_STYLE[k];
  return (
    <svg viewBox="0 0 60 28" className={className} aria-hidden="true">
      <path d={s.path} fill="none" stroke={s.ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PatternChip({ k, size = 'md' }: { k: PatternKey; size?: 'sm' | 'md' }) {
  const { prefs: { locale } } = usePrefs();
  const s = PATTERN_STYLE[k];
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[0.72rem]' : 'px-2.5 py-1 text-[0.8rem]';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${pad}`}
      style={{ background: s.chip, color: s.ink }}>
      <PatternGlyph k={k} className={size === 'sm' ? 'h-3.5 w-[34px]' : 'h-4 w-[42px]'} />
      {label(s, locale)}
    </span>
  );
}

const ORDER: PatternKey[] = ['crash', 'stuck', 'spike', 'wide', 'flat'];

export default function PatternPanel({ snap }: { snap: PatternSnapshotView }) {
  const t = useT();
  const { prefs: { locale } } = usePrefs();
  const total = ORDER.reduce((s, k) => s + (snap.counts[k] ?? 0), 0);

  return (
    <section className="glass rounded-lg p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="font-head text-[1.05rem] font-semibold">{t('รูปร่างกราฟหลังมื้ออาหาร', 'Post-meal curve shapes')}</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-[0.7rem] text-ink-40"
          title={t(
            'คำว่า พุ่ง กว้าง ค้าง ตก เป็นคำที่ทีม UP Wellness ตั้งขึ้นเอง ไม่ใช่ศัพท์ทางการแพทย์ และเกณฑ์ที่ใช้แบ่งก็เป็นเกณฑ์ของทีมเอง',
            'Spike, Wide, Stuck and Crash are names the UP Wellness team coined. They are not medical terms, and the thresholds that separate them are ours too.',
          )}>
          <IconInfo className="h-3 w-3" />
          {t('เกณฑ์ของเราเอง', 'Our own threshold')}
        </span>
        <span className="num text-[0.76rem] text-ink-40">
          {t(`อ่านรูปร่างได้ ${snap.judged} มื้อ`, `${snap.judged} ${snap.judged === 1 ? 'meal' : 'meals'} read clearly`)}
          {snap.betweenShapes > 0 && t(` · อยู่กลาง ๆ ระหว่างแบบ ${snap.betweenShapes} มื้อ`, ` · ${snap.betweenShapes} between shapes`)}
          {snap.thinData > 0 && t(` · ข้อมูลไม่พอ ${snap.thinData} มื้อ`, ` · ${snap.thinData} with too little data`)}
        </span>
      </div>

      <p className="mt-2 text-[0.92rem] font-medium leading-relaxed text-ink">{snap.headlineTh}</p>

      {snap.crashNeedsPrescriber && (
        <p role="alert" className="mt-3 rounded-sm border-l-4 border-zone-vhigh bg-zone-vhigh/10 px-3 py-2 text-[0.86rem] leading-relaxed text-zone-vhigh-ink">
          <b>{t('เจอรูปแบบ “ตก” ในเคสที่ใช้ยาลดน้ำตาลอยู่', 'A “Crash” shape in someone taking glucose-lowering medication')}</b>
          {t(' — ช่วงต่ำหลังมื้อในคนที่ใช้ยาเป็นเรื่องของขนาดยา ', ' — a post-meal low in someone on medication is a dose question. ')}
          {t('ส่งกราฟให้แพทย์ผู้สั่งยาดู ไม่ใช่เรื่องที่ปรับด้วยเมนูเอง', 'Send the chart to the prescribing doctor; this is not one to fix with a menu change.')}
        </p>
      )}

      {total > 0 && (
        <>
          {/* one row per shape that actually appeared, widest bar = most common */}
          <ul className="mt-4 space-y-2">
            {ORDER.filter((k) => (snap.counts[k] ?? 0) > 0).map((k) => {
              const n = snap.counts[k];
              const s = PATTERN_STYLE[k];
              const isDom = snap.dominant === k;
              return (
                <li key={k} className="flex items-center gap-3">
                  <span className="w-[74px] shrink-0"><PatternGlyph k={k} className="h-6 w-[64px]" /></span>
                  <span className="w-[46px] shrink-0 font-head text-[0.92rem] font-semibold"
                    style={{ color: s.ink }}>{label(s, locale)}</span>
                  <span className="h-[22px] min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-sunken">
                    <span className="block h-full rounded-sm"
                      style={{ width: `${Math.max(6, (n / total) * 100)}%`, background: s.ink, opacity: isDom ? 1 : 0.45 }} />
                  </span>
                  <span className="num w-[58px] shrink-0 text-right text-[0.84rem]"
                    style={{ color: s.ink, fontWeight: isDom ? 700 : 500 }}>{t(`${n} มื้อ`, `${n} ${n === 1 ? 'meal' : 'meals'}`)}</span>
                </li>
              );
            })}
          </ul>

          {snap.firstMoveTh && (
            <p className="mt-4 rounded-sm bg-surface-sunken px-3 py-2.5 text-[0.88rem] leading-relaxed">
              <span className="font-medium text-olive">{t('แก้แบบเดียวก่อน · ', 'Change one shape first · ')}</span>{snap.firstMoveTh}
            </p>
          )}

          {snap.examples.length > 0 && (
            <details className="mt-3 rounded-sm border border-line-soft bg-surface-raised/50">
              <summary className="cursor-pointer select-none px-3 py-2 text-[0.8rem] font-medium text-ink-70">
                {t(`ดูมื้อตัวอย่างที่เข้าเกณฑ์ (${snap.examples.length} มื้อ)`, `See the example meals (${snap.examples.length})`)}
              </summary>
              <ul className="space-y-2 px-3 pb-3 pt-1">
                {snap.examples.map((e) => (
                  <li key={e.markerId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[0.83rem]">
                    <span className="font-medium">{e.labelTh}</span>
                    <span className="num text-ink-40">{e.whenTh}</span>
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.72rem] text-ink-70">{e.patternTh}</span>
                    <span className="num w-full text-ink-40">{e.evidenceTh}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
