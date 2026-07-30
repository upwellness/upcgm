'use client';

import { forwardRef } from 'react';
import { BANDS, fmtPct } from '@/lib/bands';
import { fmtDuration, fmtThaiDate, pctToMinutesPerDay } from '@/lib/time';
import type { MealMarker, Reading, WindowSummaryWire } from '@/lib/types';
import GlucoseChart from './GlucoseChart';
import AgpChart from './AgpChart';
import type { FindingView } from './Findings';

/**
 * One page the case takes home. It is a different document from the screen, not
 * a screenshot of it:
 *
 *  - Names no product and carries no price or purchase step. A page handed to
 *    someone about their own blood sugar must not double as a sales leaflet.
 *  - Carries at most three findings. A coach can hold a person's attention for
 *    three things; a page of eleven gets folded and forgotten.
 *  - States the limitations in the same size type as the results, because the
 *    person reading it will show it to a doctor.
 *
 * 794 × 1123 px is A4 at 96dpi. Fixed, so what the browser exports is what the
 * coach saw — html2canvas at scale 2 gives a 1588px-wide image, which is sharp
 * on a phone screen and prints cleanly.
 */

export interface A4Props {
  clientName: string;
  coachNote: string;
  w: WindowSummaryWire;
  readings: Reading[];
  markers: MealMarker[];
  findings: FindingView[];
  headlineTh: string;
  limitationsTh: string[];
  narrative: string | null;
  generatedAtLabel: string;
}

const pc = (n: number) => fmtPct(n, 1);
const barLabel = (p: number) => fmtPct(p, 0);

const A4Sheet = forwardRef<HTMLDivElement, A4Props>(function A4Sheet(
  { clientName, coachNote, w, readings, markers, findings, headlineTh, limitationsTh, narrative, generatedAtLabel },
  ref,
) {
  const m = w.metrics;
  const top = findings.filter((f) => f.severity !== 'good').slice(0, 3);
  const good = findings.filter((f) => f.severity === 'good').slice(0, 2);
  const showAgp = w.gate.showAgp && w.agp.length > 0;

  return (
    <div
      ref={ref}
      className="page-a4 mx-auto bg-white text-ink"
      // Flex column so the limitations block sits at the foot of the page rather
      // than floating right under the content on a short report.
      style={{ width: 794, minHeight: 1123, padding: '38px 44px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}
    >
      <header className="flex items-start justify-between border-b-2 pb-3" style={{ borderColor: '#3D5826' }}>
        <div>
          <div className="font-head text-[1.35rem] font-semibold leading-tight" style={{ color: '#2E4420' }}>
            สรุปผลน้ำตาลต่อเนื่อง (CGM)
          </div>
          <div className="mt-0.5 text-[0.82rem] text-ink-70">
            {clientName ? `คุณ${clientName} · ` : ''}
            {fmtThaiDate(w.from, { year: true })} – {fmtThaiDate(w.to, { year: true })}
            {' · '}
            <span className="num">{w.days < 1 ? fmtDuration(Math.round(w.days * 1440)) : `${w.days.toFixed(1)} วัน`}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-head text-[0.95rem] font-semibold" style={{ color: '#3D5826' }}>UP Wellness</div>
          <div className="text-[0.7rem] text-ink-40">{generatedAtLabel}</div>
        </div>
      </header>

      <p className="mt-3.5 font-head text-[1.05rem] font-medium leading-snug">{headlineTh}</p>
      {narrative && <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink-70">{narrative}</p>}

      {m && (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2.5">
            <Big label="อยู่ในช่วงเป้าหมาย" value={w.gate.showRangePercents ? pc(m.tir70_180) : '—'} hint="70–180" tone="#367C4F" />
            <Big label="ค่าเฉลี่ย" value={String(Math.round(m.mean))} hint="มก./ดล." tone="#2A2E22" />
            <Big label="ความแกว่ง" value={w.gate.showCv ? pc(m.cv) : '—'} hint="CV · เกณฑ์ ≤ 36%" tone={m.cv <= 36 ? '#367C4F' : '#946516'} />
            <Big
              label="ประมาณ HbA1c"
              value={w.gate.showGmi && m.gmi != null ? `${m.gmi.toFixed(1)}%` : '—'}
              hint="GMI · ไม่ใช่ผลเลือด"
              tone="#2A2E22"
            />
          </div>

          <div className="mt-4">
            <SectionTitle>สัดส่วนเวลาในแต่ละช่วง</SectionTitle>
            <div className="mt-2 flex h-7 overflow-hidden rounded" style={{ background: '#EFEAE0' }}>
              {[
                { b: BANDS[0], p: m.tbrUnder54 },
                { b: BANDS[1], p: m.tbrUnder70 - m.tbrUnder54 },
                { b: BANDS[2], p: m.tir70_180 },
                { b: BANDS[3], p: m.tar180to250 },
                { b: BANDS[4], p: m.tarOver250 },
              ].map(({ b, p }) => p > 0 && (
                <div key={b.key} style={{ width: `${Math.max(0, p)}%`, background: b.fill, minWidth: 2 }}
                  className="grid place-items-center">
                  {p >= 9 && <span className="num text-[0.66rem] font-semibold text-white">{barLabel(p)}</span>}
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.7rem] text-ink-70">
              {BANDS.map((b) => (
                <span key={b.key} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: b.fill }} />
                  {b.labelTh}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="mt-4">
        <SectionTitle>{showAgp ? 'ภาพวันปกติของคุณ (รวมทุกวันซ้อนกัน)' : 'กราฟน้ำตาลในช่วงที่ดู'}</SectionTitle>
        <div className="mt-1.5 rounded border" style={{ borderColor: 'rgba(42,46,34,.12)', padding: '4px 2px' }}>
          {showAgp ? (
            <AgpChart bins={w.agp} height={196} />
          ) : (
            <GlucoseChart
              t={readings.map((r) => r.t)}
              v={readings.map((r) => r.v)}
              flag={readings.map((r) => r.flag)}
              from={w.from}
              to={w.to}
              markers={markers}
              height={210}
              staticMode
            />
          )}
        </div>
        {showAgp && (
          <p className="mt-1 text-[0.68rem] text-ink-40">
            เส้นเข้มคือค่ากลาง แถบเข้มคือช่วงที่พบบ่อย (25–75%) แถบอ่อนคือ 5–95% — แถบยิ่งกว้าง วันแต่ละวันยิ่งต่างกัน
          </p>
        )}
      </div>

      {top.length > 0 && (
        <div className="mt-4">
          <SectionTitle>สิ่งที่ควรทำต่อ</SectionTitle>
          <ol className="mt-2 space-y-2">
            {top.map((f, i) => (
              <li key={f.id} className="flex gap-2.5">
                <RankBadge n={i + 1} severity={f.severity} />
                <div className="min-w-0">
                  <div className="text-[0.88rem] font-medium leading-snug">{f.titleTh}</div>
                  <div className="num text-[0.76rem] leading-snug text-ink-70">{f.evidenceTh}</div>
                  {f.actionTh && <div className="mt-0.5 text-[0.8rem] leading-snug" style={{ color: '#2E4420' }}>→ {f.actionTh}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {good.length > 0 && (
        <div className="mt-3.5 rounded px-3 py-2" style={{ background: 'rgba(62,142,90,.09)' }}>
          <div className="text-[0.78rem] font-medium" style={{ color: '#367C4F' }}>สิ่งที่ทำได้ดีอยู่แล้ว</div>
          <ul className="mt-0.5 space-y-0.5">
            {good.map((f) => (
              <li key={f.id} className="num text-[0.76rem] text-ink-70">· {f.titleTh} — {f.evidenceTh}</li>
            ))}
          </ul>
        </div>
      )}

      {coachNote.trim() && (
        <div className="mt-3.5">
          <SectionTitle>บันทึกจากโค้ช</SectionTitle>
          <p className="mt-1 whitespace-pre-wrap text-[0.85rem] leading-relaxed">{coachNote.trim()}</p>
        </div>
      )}

      <footer className="mt-auto pt-4">
        <div className="rounded px-3 py-2.5" style={{ background: '#F7F4EE' }}>
          <div className="text-[0.72rem] font-medium text-ink-70">ข้อจำกัดของรายงานนี้</div>
          <ul className="mt-1 space-y-0.5">
            {limitationsTh.slice(0, 4).map((l, i) => (
              <li key={i} className="text-[0.7rem] leading-snug text-ink-70">· {l}</li>
            ))}
          </ul>
        </div>
        <p className="mt-2 text-center text-[0.66rem] text-ink-40">
          เอกสารนี้ใช้เพื่อพูดคุยเรื่องพฤติกรรมสุขภาพ ไม่ใช่การวินิจฉัยโรค ไม่ใช้แทนคำแนะนำของแพทย์
          และไม่ใช้ตัดสินใจเรื่องยาด้วยตัวเอง
        </p>
      </footer>
    </div>
  );
});

/**
 * Drawn as SVG rather than a styled span. The PNG exporter lays out HTML text
 * itself and put every digit above and left of its circle; an SVG is rasterised
 * by the browser, so what the coach sees on screen is what the case receives.
 */
function RankBadge({ n, severity }: { n: number; severity: FindingView['severity'] }) {
  const fill = severity === 'urgent' ? '#B4472F' : severity === 'attention' ? '#C98A1E' : '#3A6E86';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0" style={{ marginTop: 3 }} aria-hidden="true">
      <circle cx="9" cy="9" r="9" fill={fill} />
      <text x="9" y="9" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="600" fill="#fff">
        {n}
      </text>
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-head text-[0.8rem] font-semibold uppercase tracking-wide" style={{ color: '#3D5826' }}>
      {children}
    </h2>
  );
}

function Big({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: string }) {
  return (
    <div className="rounded px-2.5 py-2" style={{ background: '#F7F4EE' }}>
      <div className="text-[0.68rem] leading-tight text-ink-70">{label}</div>
      <div className="num font-head text-[1.3rem] font-semibold leading-none" style={{ color: tone, marginTop: 3 }}>{value}</div>
      <div className="text-[0.63rem] text-ink-40" style={{ marginTop: 2 }}>{hint}</div>
    </div>
  );
}

export default A4Sheet;
