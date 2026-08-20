'use client';

import { BANDS, fmtPct, bandLabel, abbrTitle, bandAbbrTitle, METRIC_ABBR, type MetricAbbrKey } from '@/lib/bands';
import { usePrefs, useT } from './PrefsProvider';
import { fmtDuration, pctToMinutesPerDay } from '@/lib/time';
import type { Metrics, WindowSummaryWire } from '@/lib/types';
import {
  IconArrowDown, IconArrowUp, IconAverage, IconClock, IconInfo, IconLab, IconMoon, IconTarget, IconWave,
} from './Icons';

/** Rounded to one decimal everywhere: a coach reading 97.0808% loses the point. */
const pc = (n: number) => fmtPct(n, 1);
const barLabel = (p: number) => fmtPct(p, 0);

export function RangeBar({ m, showPercents }: { m: Metrics; showPercents: boolean }) {
  const t = useT();
  const { prefs: { locale } } = usePrefs();
  const parts = [
    { band: BANDS[0], pct: m.tbrUnder54 },
    { band: BANDS[1], pct: m.tbrUnder70 - m.tbrUnder54 },
    { band: BANDS[2], pct: m.tir70_180 },
    { band: BANDS[3], pct: m.tar180to250 },
    { band: BANDS[4], pct: m.tarOver250 },
  ].map((p) => ({ ...p, pct: Math.max(0, p.pct) }));

  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded-sm bg-surface-sunken" role="img"
        aria-label={parts.map((p) => `${bandLabel(p.band.key, p.band.labelTh, locale)} ${pc(p.pct)}`).join(', ')}>
        {parts.map((p) => (
          p.pct > 0 && (
            <div
              key={p.band.key}
              // A sliver under ~4% cannot show a label but must still be visible:
              // 1.4% of the day below 54 mg/dL is the most important 1.4% on screen.
              style={{ width: `${p.pct}%`, background: p.band.fill, minWidth: p.pct > 0 ? '3px' : 0 }}
              className="grid place-items-center"
              title={`${bandLabel(p.band.key, p.band.labelTh, locale)} · ${pc(p.pct)}`}
            >
              {p.pct >= 7 && showPercents && (
                <span className="num px-1 text-[0.7rem] font-semibold text-accent-ink/95">{barLabel(p.pct)}</span>
              )}
            </div>
          )
        ))}
      </div>
      <ul className="mt-3 grid gap-x-4 gap-y-1.5 text-[0.83rem] sm:grid-cols-2">
        {parts.map((p) => (
          <li key={p.band.key} className="flex items-baseline gap-2">
            <span className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.band.fill }} />
            <span className="text-ink-70">{bandLabel(p.band.key, p.band.labelTh, locale)}</span>
            <AbbrTag text={p.band.abbr} title={bandAbbrTitle(p.band.key, locale)} />
            <span className="num ml-auto font-semibold" style={{ color: p.band.ink }}>
              {showPercents ? pc(p.pct) : '—'}
            </span>
            {showPercents && p.pct > 0 && (
              <span className="num hidden w-[4.6rem] shrink-0 text-right text-[0.76rem] text-ink-40 min-[380px]:inline">
                {fmtDuration(pctToMinutesPerDay(p.pct), locale)}{t('/วัน', ' a day')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The consensus name for a number, sitting beside the friendly Thai one — so a
 * coach can carry "อยู่ในช่วงเป้าหมาย 63%" to a doctor as "TIR 63%" and be
 * understood. An <abbr> rather than a styled span, because a tag is only worth
 * printing if the reader can find out what it stands for without leaving the
 * page: hover, long-press and screen readers all reach the expansion.
 */
export function AbbrTag({ text, title }: { text: string; title: string }) {
  return (
    <abbr
      title={title}
      className="shrink-0 cursor-help rounded-[5px] border border-line px-1 pb-px text-[0.68rem] font-semibold leading-[1.45] tracking-[0.02em] text-ink-70 no-underline"
    >
      {text}
    </abbr>
  );
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone?: 'plain' | 'in' | 'high' | 'low' | 'vhigh';
  note?: string;
  /**
   * Standard nomenclature key. Left off where none is agreed — average glucose
   * and the overnight window have no consensus abbreviation, and inventing one
   * would dress house vocabulary up as the real thing.
   */
  abbr?: MetricAbbrKey;
}

const TONE: Record<NonNullable<CardProps['tone']>, string> = {
  plain: 'text-ink',
  in: 'text-zone-in-ink',
  high: 'text-zone-high-ink',
  low: 'text-zone-low-ink',
  vhigh: 'text-zone-vhigh-ink',
};

export function MetricCard({ label, value, sub, icon, tone = 'plain', note, abbr }: CardProps) {
  const { prefs: { locale } } = usePrefs();
  return (
    <div className="glass rounded-md p-4 shadow-sm">
      {/* Wraps rather than clips: at the largest text size the label and its tag
          together outrun a two-up card, and a tag sliding under the edge is
          worse than one sitting on its own line. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-70">
        <span className={`mr-0.5 ${TONE[tone]}`}>{icon}</span>
        <span className="text-[0.83rem] font-medium">{label}</span>
        {abbr && <AbbrTag text={METRIC_ABBR[abbr].abbr} title={abbrTitle(abbr, locale)} />}
        {note && (
          <span className="ml-auto text-ink-40" title={note} aria-label={note}>
            <IconInfo className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div className={`num mt-2 font-head text-[1.45rem] font-semibold leading-none sm:text-[1.6rem] ${TONE[tone]}`}>{value}</div>
      {sub && <div className="mt-1.5 text-[0.78rem] leading-snug text-ink-40">{sub}</div>}
    </div>
  );
}

export function MetricGrid({ w }: { w: WindowSummaryWire }) {
  const t = useT();
  const { prefs: { locale } } = usePrefs();
  const m = w.metrics;
  if (!m) {
    return (
      <p className="glass rounded-md p-5 text-[0.9rem] text-ink-70">
        {t('ช่วงเวลานี้ไม่มีข้อมูลที่ใช้คำนวณได้ — ลองเลือกช่วงที่กว้างขึ้น', 'No usable data in this window — try a wider one.')}
      </p>
    );
  }
  const g = w.gate;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard
        label={t('อยู่ในช่วงเป้าหมาย', 'In target')}
        abbr="tir"
        value={g.showRangePercents ? pc(m.tir70_180) : '—'}
        sub={t('70–180 มก./ดล. · เกณฑ์สากล ≥ 70%', '70–180 mg/dL · consensus goal 70% or more')}
        icon={<IconTarget className="h-4 w-4" />}
        tone={g.showRangePercents ? (m.tir70_180 >= 70 ? 'in' : 'high') : 'plain'}
      />
      <MetricCard
        label={t('ช่วงเหมาะสม', 'Tight range')}
        abbr="titr"
        value={g.showRangePercents ? pc(m.titr70_140) : '—'}
        sub={t('70–140 มก./ดล. · ยังไม่มีเกณฑ์สากล ใช้เทียบกับตัวเอง', '70–140 mg/dL · no consensus goal — compare against yourself')}
        icon={<IconEyeish />}
        note={t('ช่วง 70–140 เป็นเกณฑ์ที่ทีม UP Wellness ใช้เทียบผลข้ามสัปดาห์ ไม่ใช่มาตรฐานสากล', 'The 70–140 band is one the UP Wellness team uses to compare week to week. It is not an international standard.')}
      />
      <MetricCard
        label={t('ค่าเฉลี่ย', 'Average')}
        value={`${Math.round(m.mean)}`}
        sub={t('มก./ดล.', 'mg/dL')}
        icon={<IconAverage className="h-4 w-4" />}
      />
      <MetricCard
        label={t('ความแกว่ง', 'Variability')}
        abbr="cv"
        value={g.showCv ? pc(m.cv) : '—'}
        sub={g.showCv ? t('เกณฑ์ ≤ 36% ถือว่านิ่ง', '36% or below counts as steady') : t('ช่วงเวลาสั้นเกินกว่าจะคิด', 'Window too short to compute')}
        icon={<IconWave className="h-4 w-4" />}
        tone={g.showCv ? (m.cv <= 36 ? 'in' : 'high') : 'plain'}
      />
      <MetricCard
        label={t('ต่ำกว่า 70', 'Below 70')}
        abbr="tbr"
        value={g.showRangePercents ? pc(m.tbrUnder70) : '—'}
        sub={g.showRangePercents ? t(`เกณฑ์ ≤ 4% · ต่ำกว่า 54 = ${pc(m.tbrUnder54)}`, `Goal 4% or less · below 54 = ${pc(m.tbrUnder54)}`) : undefined}
        icon={<IconArrowDown className="h-4 w-4" />}
        tone={g.showRangePercents ? (m.tbrUnder70 > 4 || m.tbrUnder54 > 1 ? 'low' : 'in') : 'plain'}
      />
      <MetricCard
        label={t('สูงกว่า 180', 'Above 180')}
        abbr="tar"
        value={g.showRangePercents ? pc(m.tarOver180) : '—'}
        sub={g.showRangePercents ? t(`เกณฑ์ ≤ 25% · สูงกว่า 250 = ${pc(m.tarOver250)}`, `Goal 25% or less · above 250 = ${pc(m.tarOver250)}`) : undefined}
        icon={<IconArrowUp className="h-4 w-4" />}
        tone={g.showRangePercents ? (m.tarOver180 > 25 || m.tarOver250 > 5 ? 'high' : 'in') : 'plain'}
      />
      <MetricCard
        label={t('ประมาณ HbA1c', 'Estimated HbA1c')}
        abbr="gmi"
        value={g.showGmi && m.gmi != null ? `${m.gmi.toFixed(1)}%` : '—'}
        sub={g.showGmi && m.gmi != null ? t('ค่าประมาณจากค่าเฉลี่ย ไม่ใช่ผลเลือด', 'Estimated from the average, not a blood test') : t('ต้องมีข้อมูลอย่างน้อย 3 วัน', 'Needs at least 3 days of data')}
        icon={<IconLab className="h-4 w-4" />}
        note={t('GMI = 3.31 + 0.02392 × ค่าเฉลี่ย (Bergenstal 2018) เป็นค่าประมาณ อาจต่างจาก HbA1c ที่เจาะเลือดได้ราว 0.5%', 'GMI = 3.31 + 0.02392 × mean (Bergenstal 2018). It is an estimate and can differ from a lab HbA1c by around 0.5%.')}
      />
      <MetricCard
        label={t('กลางคืน (00:00–06:00)', 'Overnight (00:00–06:00)')}
        value={m.nightMean != null ? `${Math.round(m.nightMean)}` : '—'}
        sub={m.nightTbrUnder70 != null ? t(`ต่ำกว่า 70 = ${pc(m.nightTbrUnder70)} ของช่วงกลางคืน`, `Below 70 for ${pc(m.nightTbrUnder70)} of the night`) : t('ไม่มีข้อมูลช่วงกลางคืน', 'No overnight data')}
        icon={<IconMoon className="h-4 w-4" />}
        note={t('ช่วงกลางคืน 00:00–06:00 เป็นช่วงที่ทีมกำหนดเอง ไม่ใช่มาตรฐานสากล', 'The 00:00–06:00 night window is one this team defined, not an international standard.')}
      />
    </div>
  );
}

/** Small local glyph: a bracket that reads as "a narrower window". */
function IconEyeish() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M7 5v14M17 5v14M10.5 12h3" />
    </svg>
  );
}

export function SpanStrip({ w, intervalMinutes }: { w: WindowSummaryWire; intervalMinutes: number }) {
  const t = useT();
  const { prefs: { locale } } = usePrefs();
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[0.82rem] text-ink-70">
      <span className="inline-flex items-center gap-1.5">
        <IconClock className="h-3.5 w-3.5 text-ink-40" />
        <span className="num">{w.days < 1 ? fmtDuration(Math.round(w.days * 1440), locale) : t(`${w.days.toFixed(1)} วัน`, `${w.days.toFixed(1)} days`)}</span>
      </span>
      <span className="num">{w.n.toLocaleString(locale === 'en' ? 'en-US' : 'th-TH')} {t('ค่า', 'readings')}</span>
      <span className="num">{t(`เก็บได้ ${w.capturePct.toFixed(0)}%`, `${w.capturePct.toFixed(0)}% captured`)}</span>
      <span className="num">{t(`ทุก ${intervalMinutes} นาที`, `every ${intervalMinutes} min`)}</span>
    </div>
  );
}
