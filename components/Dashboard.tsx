'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiEnabled, loadAiConfig, type AiConfig, EMPTY as EMPTY_AI } from '@/lib/ai-config';
import { mealResponse, readingsFromWire } from '@/lib/meal-response';
import { loadMarkers, saveMarkers } from '@/lib/markers-store';
import { fmtDateTime, fmtDate, fromLocalInputValue, toLocalInputValue } from '@/lib/time';
import type { AnalysisResult, GlucoseLoweringMeds, MealMarker, Metrics, Reading, WindowSummaryWire } from '@/lib/types';
import AgpChart, { type AgpNoteView } from './AgpChart';
import ExportDialog from './ExportDialog';
import Findings, { type FindingView } from './Findings';
import GlucoseChart from './GlucoseChart';
import { IconAlert, IconCalendar, IconImage, IconInfo, IconSparkle, IconUpload } from './Icons';
import MealPanel, { type MealPatternView } from './MealPanel';
import { MetricGrid, RangeBar, SpanStrip } from './Metrics';
import EventExplorer, { type CgmEventView, type EventSnapshotView } from './EventExplorer';
import PatternPanel, { type PatternSnapshotView } from './PatternPanel';
import { windowChip, windowLabel } from '@/lib/bands';
import PrefsMenu from './PrefsMenu';
import { usePrefs, useT } from './PrefsProvider';
import Uploader from './Uploader';

interface AiResponse {
  interpretation?: {
    headlineTh: string;
    findings: FindingView[];
    limitationsTh: string[];
    escalate: boolean;
    patterns: PatternSnapshotView | null;
    perMeal: MealPatternView[];
    events: CgmEventView[];
    eventSnapshot: EventSnapshotView;
    agpNotes: AgpNoteView[];
  };
  /**
   * Figures for a hand-picked or zoomed range, worked out by the server because
   * the maths does not live in the browser. Absent for a preset window, which
   * already arrived with its own.
   */
  windowMetrics?: Metrics | null;
  windowGate?: WindowSummaryWire['gate'] | null;
  narrative?: string | null;
  reasonTh?: string | null;
}

export default function Dashboard() {
  const t = useT();
  const { prefs: { locale } } = usePrefs();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [meds, setMeds] = useState<GlucoseLoweringMeds | null>(null);
  const [markers, setMarkers] = useState<MealMarker[]>([]);
  const [storageWorks, setStorageWorks] = useState(true);
  const [windowKey, setWindowKey] = useState<string>('');
  const [custom, setCustom] = useState<{ from: number; to: number } | null>(null);
  const [ai, setAi] = useState<AiResponse | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [markersRestored, setMarkersRestored] = useState(0);
  const [aiCfg, setAiCfg] = useState<AiConfig>(EMPTY_AI);
  // Bumped by the button. The findings request runs on every change; the model
  // is only asked when this goes up, so nothing leaves the machine unbidden.
  const [narrativeNonce, setNarrativeNonce] = useState(0);
  const aiSeq = useRef(0);

  useEffect(() => { setAiCfg(loadAiConfig()); }, []);

  const aiOn = aiEnabled(aiCfg);

  const readings: Reading[] = useMemo(
    () => (result ? readingsFromWire(result.series) : []),
    [result],
  );

  const activeWindow: WindowSummaryWire | null = useMemo(() => {
    if (!result) return null;
    if (custom) return buildCustomWindow(result, custom.from, custom.to, locale);
    return result.windows.find((w) => w.key === windowKey) ?? result.windows[0] ?? null;
  }, [result, windowKey, custom, locale]);

  const responses = useMemo(
    () => markers.map((m) => mealResponse(m.id, m.t, readings)),
    [markers, readings],
  );

  // Restore markers whenever a new dataset lands. A coach re-opening last week's
  // file should find their meal notes already on the chart.
  useEffect(() => {
    if (!result) return;
    const saved = loadMarkers(result.datasetId);
    setMarkers(saved);
    setMarkersRestored(saved.length);
    // Widest preset the file genuinely fills, else the widest available. A
    // truncated "30 days" showing 15 days of data is a bad first impression.
    const full = result.windows.find((wd) => !wd.truncated);
    setWindowKey((full ?? result.windows[0])?.key ?? '');
    setCustom(null);
  }, [result]);

  const persist = useCallback(
    (next: MealMarker[]) => {
      setMarkers(next);
      if (result) {
        const ok = saveMarkers(result.datasetId, result.sourceName, next);
        setStorageWorks(ok);
      }
    },
    [result],
  );

  // Findings are recomputed on the server whenever the window, the medication
  // answer or the meal markers change — one definition of every rule, and the
  // rules never reach the browser.
  useEffect(() => {
    if (!result || !activeWindow || meds == null) return;
    const seq = ++aiSeq.current;
    setAiBusy(true);
    const slice = readings.filter((r) => r.t >= activeWindow.from && r.t <= activeWindow.to);
    const payload = { locale,
      // `metrics` stays null for a hand-picked range. Substituting the file's
      // own here is what made the findings describe the whole wear under a
      // heading that named one evening — the window bounds below let the server
      // compute the right ones instead.
      result: { ...result, metrics: activeWindow.metrics, quality: { ...result.quality, spanDays: activeWindow.days, capturePct: activeWindow.capturePct }, lowEvents: activeWindow.lowEvents },
      windowFrom: activeWindow.from,
      windowTo: activeWindow.to,
      meds,
      markers: markers.filter((m) => m.t >= activeWindow.from && m.t <= activeWindow.to),
      responses: responses.filter((r) => markers.find((m) => m.id === r.markerId && m.t >= activeWindow.from && m.t <= activeWindow.to)),
      wantNarrative: narrativeNonce > 0 && aiOn,
      aiKey: aiOn ? aiCfg.apiKey : undefined,
      aiModel: aiOn ? aiCfg.model : undefined,
    };
    fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then((r) => r.json() as Promise<AiResponse>)
      .then((json) => {
        // A slow earlier request must not overwrite a newer answer.
        if (seq === aiSeq.current) setAi(json);
      })
      .catch(() => {
        if (seq === aiSeq.current) setAi({ reasonTh: t('เชื่อมต่อไม่ได้ — ลองเลือกช่วงเวลาใหม่อีกครั้ง', 'Could not connect — pick the window again.') });
      })
      .finally(() => {
        if (seq === aiSeq.current) setAiBusy(false);
      });
    // `slice` is only used for its length in the payload guard below.
    void slice;
  }, [result, activeWindow, meds, markers, responses, readings, narrativeNonce, aiOn, aiCfg.apiKey, aiCfg.model, locale]);

  if (!result) {
    return (
      <>
        <div className="mx-auto flex max-w-6xl justify-end px-4 pt-4 sm:px-6">
          <PrefsMenu />
        </div>
        <Uploader onResult={setResult} />
      </>
    );
  }

  // A hand-picked range has no figures until the server sends them back, and
  // AGP stays off for it: the bins are only built for the preset windows, so a
  // gate that switched it on would open an empty panel.
  const w = activeWindow && !activeWindow.metrics && ai?.windowMetrics
    ? {
        ...activeWindow,
        metrics: ai.windowMetrics,
        gate: ai.windowGate ? { ...ai.windowGate, showAgp: false } : activeWindow.gate,
      }
    : activeWindow;
  const interp = ai?.interpretation;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-6 sm:pb-8 lg:py-8">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-head text-[1.25rem] font-semibold tracking-tight sm:text-[1.35rem]">CGM Analyser</h1>
          <p className="truncate text-[0.8rem] text-ink-40 sm:text-[0.83rem]">
            {result.sourceName} · <span className="num">{result.quality.rowsUsed.toLocaleString(locale === 'en' ? 'en-US' : 'th-TH')} {t('ค่า', 'readings')}</span>
            {' · '}
            <span className="num">{fmtDate(result.metrics.firstT, locale)} – {fmtDate(result.metrics.lastT, locale, { year: true })}</span>
          </p>
        </div>
        <PrefsMenu />
        {/* Desktop keeps the actions in the header. On a phone they move to a
            sticky bar at the bottom, within thumb reach and always visible after
            a long scroll through the findings. */}
        <div className="hidden gap-2 sm:flex">
          <button
            onClick={() => setExportOpen(true)}
            disabled={!w || meds == null}
            className="inline-flex items-center gap-1.5 rounded-sm bg-gold px-3.5 py-2.5 text-[0.86rem] font-medium text-ink transition hover:brightness-95 disabled:opacity-40"
          >
            <IconImage className="h-4 w-4" /> {t('สร้างใบสรุปให้เคส', 'Build client handout')}
          </button>
          <button
            onClick={() => { setResult(null); setAi(null); setMeds(null); }}
            className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface-raised/70 px-3.5 py-2.5 text-[0.86rem] transition hover:bg-surface-raised"
          >
            <IconUpload className="h-4 w-4" /> {t('เปลี่ยนไฟล์', 'Change file')}
          </button>
          <Link
            href="/config"
            title={aiOn ? t('ตั้งค่า · เปิดใช้สรุปด้วย AI อยู่', 'Settings · AI summary is on') : t('ตั้งค่า · ยังไม่ได้เปิดใช้ AI', 'Settings · AI summary is off')}
            className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface-raised/70 px-3 py-2.5 text-[0.86rem] transition hover:bg-surface-raised"
          >
            {t('ตั้งค่า', 'Settings')}
            {aiOn && <span className="h-1.5 w-1.5 rounded-full bg-zone-in" aria-label={t('เปิดใช้ AI อยู่', 'AI summary on')} />}
          </Link>
        </div>
      </header>

      {markersRestored > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-zone-in/10 px-3.5 py-2.5 text-[0.85rem] text-zone-in-ink">
          <IconInfo className="mt-0.5 h-4 w-4" />
          {t(`พบมื้ออาหาร ${markersRestored} รายการที่บันทึกไว้ในเครื่องนี้สำหรับไฟล์ชุดเดียวกัน — ดึงขึ้นมาให้แล้ว`, `Found ${markersRestored} meals saved on this device for the same file — restored.`)}
        </p>
      )}

      {meds == null ? (
        <MedsQuestion onAnswer={setMeds} />
      ) : (
        <>
          <QualityStrip result={result} />

          <RangePicker
            windows={result.windows}
            activeKey={custom ? '__custom' : w?.key ?? ''}
            custom={custom}
            bounds={{ from: result.metrics.firstT, to: result.metrics.lastT }}
            onPreset={(k) => { setCustom(null); setWindowKey(k); }}
            onCustom={(from, to) => setCustom({ from, to })}
          />

          {w && (
            <>
              {w.gate.noteTh && (
                <p className="mt-4 flex items-start gap-2 rounded-md bg-zone-high/12 px-3.5 py-2.5 text-[0.85rem] leading-relaxed text-zone-high-ink">
                  <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {w.gate.noteTh}
                </p>
              )}

              <section className="mt-4 glass rounded-lg p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="font-head text-[1.05rem] font-semibold">{windowLabel(w.key, w.labelTh, locale)}</h2>
                  <SpanStrip w={w} intervalMinutes={result.quality.intervalMinutes} />
                </div>
                <GlucoseChart
                  t={result.series.t}
                  v={result.series.v}
                  flag={result.series.flag}
                  from={w.from}
                  to={w.to}
                  markers={markers}
                  height={320}
                  onFocusRange={(f, t2) => setCustom({ from: f, to: t2 })}
                />
              </section>

              <section className="mt-4">
                <MetricGrid w={w} />
              </section>

              {w.metrics && (
                <section className="mt-4 glass rounded-lg p-4 shadow-sm sm:p-5">
                  <h2 className="mb-3 font-head text-[1.05rem] font-semibold">{t('สัดส่วนเวลาในแต่ละช่วง', 'Share of time in each band')}</h2>
                  <RangeBar m={w.metrics} showPercents={w.gate.showRangePercents} />
                </section>
              )}

              {w.gate.showAgp && w.agp.length > 0 && (
                <section className="mt-4 glass rounded-lg p-4 shadow-sm sm:p-5">
                  <h2 className="font-head text-[1.05rem] font-semibold">{t('ภาพวันปกติ', 'A typical day')}</h2>
                  <p className="mb-3 mt-1 text-[0.83rem] leading-relaxed text-ink-40">
                    {t('เอาทุกวันมาซ้อนกันบนแกน 24 ชั่วโมง — ตอบคำถามว่า “ช่วงไหนของวันที่มักมีปัญหา”', 'Every day laid over one 24-hour axis — it answers “which part of the day tends to go wrong”.')}
                  </p>
                  <AgpChart bins={w.agp} height={260} notes={interp?.agpNotes ?? []} />
                  {(interp?.agpNotes?.length ?? 0) > 0 && (
                    <p className="mt-2 text-[0.78rem] leading-relaxed text-ink-40">
                      {t('จุดบนกราฟคือช่วงเวลาที่มีอะไรน่าสังเกต — แตะหรือเอาเมาส์ไปวางเพื่อดูว่าเรื่องอะไร', 'The dots mark hours worth noticing — tap or hover one to see what it is.')}
                    </p>
                  )}
                </section>
              )}

              <section className="mt-5">
                <div className="mb-3 flex items-center gap-2">
                  <IconSparkle className="h-4 w-4 text-olive" />
                  <h2 className="font-head text-[1.1rem] font-semibold">{t('สิ่งที่ข้อมูลบอก', 'What the data says')}</h2>
                  {aiBusy && <span className="text-[0.8rem] text-ink-40">{t('กำลังคำนวณ…', 'Working…')}</span>}
                  <div className="ml-auto">
                    {aiOn ? (
                      <button
                        onClick={() => setNarrativeNonce((n) => n + 1)}
                        disabled={aiBusy}
                        className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-sm border border-olive/40 bg-surface-raised/70 px-3 py-1.5 text-[0.82rem] font-medium text-olive transition hover:bg-surface-raised disabled:opacity-40"
                      >
                        <IconSparkle className="h-3.5 w-3.5" />
                        {narrativeNonce > 0 ? t('สรุปใหม่ด้วย AI', 'Summarise again with AI') : t('สรุปด้วย AI', 'Summarise with AI')}
                      </button>
                    ) : (
                      <Link href="/config"
                        className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-sm border border-line bg-surface-raised/60 px-3 py-1.5 text-[0.8rem] text-ink-40 transition hover:bg-surface-raised">
                        {t('เปิดใช้สรุปด้วย AI →', 'Switch on the AI summary →')}
                      </Link>
                    )}
                  </div>
                </div>

                {interp && (
                  <div className="glass mb-3 rounded-lg p-4 shadow-sm sm:p-5">
                    <p className="font-head text-[1.05rem] font-medium leading-snug">{interp.headlineTh}</p>
                    {ai?.narrative && (
                      <p className="mt-2 whitespace-pre-wrap text-[0.92rem] leading-relaxed text-ink-70">{ai.narrative}</p>
                    )}
                    {!ai?.narrative && ai?.reasonTh && (
                      <p className="mt-2 text-[0.82rem] text-ink-40">{ai.reasonTh}</p>
                    )}
                  </div>
                )}

                {interp && <Findings findings={interp.findings} />}

                {interp && interp.limitationsTh.length > 0 && (
                  <div className="mt-4 rounded-md border border-line bg-surface-raised/50 p-4">
                    <h3 className="text-[0.85rem] font-medium text-ink-70">{t('ข้อจำกัดที่ต้องบอกเคส', 'Limits to tell the client')}</h3>
                    <ul className="mt-1.5 space-y-1">
                      {interp.limitationsTh.map((l, i) => (
                        <li key={i} className="text-[0.83rem] leading-relaxed text-ink-70">· {l}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {interp?.eventSnapshot && interp.events.length > 0 && (
                <section className="mt-5">
                  <EventExplorer
                    snap={interp.eventSnapshot}
                    events={interp.events}
                    readings={readings}
                  />
                </section>
              )}

              <section className="mt-5">
                <MealPanel
                  datasetId={result.datasetId}
                  sourceName={result.sourceName}
                  readings={readings}
                  markers={markers}
                  onChange={persist}
                  defaultT={Math.round((w.from + w.to) / 2)}
                  storageWorks={storageWorks}
                  perMeal={interp?.perMeal ?? []}
                />
              </section>

              <div className="glass-bar no-print fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:hidden">
                <button
                  onClick={() => setExportOpen(true)}
                  disabled={meds == null}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm bg-gold px-3 py-3 text-[0.9rem] font-medium text-ink disabled:opacity-40"
                >
                  <IconImage className="h-4 w-4" /> {t('ใบสรุปให้เคส', 'Client handout')}
                </button>
                <button
                  onClick={() => { setResult(null); setAi(null); setMeds(null); }}
                  aria-label={t('เปลี่ยนไฟล์', 'Change file')}
                  className="inline-flex items-center justify-center rounded-sm border border-line bg-surface-raised/80 px-4 py-3"
                >
                  <IconUpload className="h-4 w-4" />
                </button>
              </div>

              <ExportDialog
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                w={w}
                readings={readings}
                markers={markers}
                findings={interp?.findings ?? []}
                headlineTh={interp?.headlineTh ?? ''}
                limitationsTh={interp?.limitationsTh ?? []}
                narrative={ai?.narrative ?? null}
                patterns={interp?.patterns ?? null}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Asked once, before any number appears. Whether the person is on a medicine that
 * can drive glucose down changes what a reading of 62 means — a normal dip versus
 * an event worth a phone call — and no amount of chart drawing recovers that.
 */
function MedsQuestion({ onAnswer }: { onAnswer: (m: GlucoseLoweringMeds) => void }) {
  const t = useT();
  return (
    <section className="glass mx-auto max-w-2xl rounded-lg p-6 shadow-md">
      <h2 className="font-head text-[1.15rem] font-semibold">{t('ก่อนดูผล — ขอถามข้อเดียว', 'One question before the results')}</h2>
      <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-70">
        {t('เคสใช้ยาหรืออินซูลินที่ทำให้น้ำตาลลดอยู่หรือไม่ (เช่น ยาเบาหวานกลุ่มซัลโฟนิลยูเรีย หรืออินซูลิน)', 'Does this person take medication or insulin that lowers glucose (a sulfonylurea, for example, or insulin)?')}
      </p>
      <p className="mt-1.5 text-[0.83rem] leading-relaxed text-ink-40">
        {t('คำตอบนี้เปลี่ยนวิธีอ่านช่วงน้ำตาลต่ำ — ถ้าใช้ยาอยู่ ช่วงต่ำเป็นเรื่องที่ต้องให้แพทย์ดู ไม่ใช่เรื่องที่ปรับด้วยอาหารเอง', 'The answer changes how lows are read. On medication, a low is one for the doctor, not something to adjust with food.')}
      </p>
      <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
        <button onClick={() => onAnswer('yes')}
          className="min-h-[3rem] rounded-sm bg-accent px-4 py-3 text-[0.92rem] font-medium text-accent-ink transition hover:bg-accent-dark">
          {t('ใช้อยู่', 'Yes')}
        </button>
        <button onClick={() => onAnswer('no')}
          className="min-h-[3rem] rounded-sm border border-line bg-surface-raised/80 px-4 py-3 text-[0.92rem] transition hover:bg-surface-raised">
          {t('ไม่ใช้', 'No')}
        </button>
        <button onClick={() => onAnswer('unknown')}
          className="min-h-[3rem] rounded-sm border border-line bg-surface-raised/80 px-4 py-3 text-[0.92rem] transition hover:bg-surface-raised">
          {t('ยังไม่ทราบ', 'Not known')}
        </button>
      </div>
    </section>
  );
}

function QualityStrip({ result }: { result: AnalysisResult }) {
  const t = useT();
  const { prefs: { locale } } = usePrefs();
  const q = result.quality;
  const artifacts = q.qcNotes.filter((n) => n.kind === 'floor-artifact');
  const items: string[] = [];
  if (q.unitConverted) items.push(t(`ไฟล์เป็นหน่วย ${q.unitDetected} — แปลงเป็น มก./ดล. แล้ว`, `File used ${q.unitDetected} — converted to mg/dL`));
  if (q.duplicatesDropped > 0) items.push(t(`เวลาซ้ำ ${q.duplicatesDropped} แถว`, `${q.duplicatesDropped} duplicate timestamps`));
  if (q.rejected.length > 0) items.push(t(`อ่านไม่ได้ ${q.rejected.length} แถว`, `${q.rejected.length} unreadable rows`));
  if (artifacts.length > 0) items.push(t(`ช่วงที่เซนเซอร์น่าจะหลุด ${artifacts.length} ช่วง — ไม่นับในการคำนวณ`, `${artifacts.length} likely sensor dropouts — excluded from the calculations`));
  if (q.gaps.length > 0) items.push(t(`ช่วงที่ไม่มีข้อมูล ${q.gaps.length} ช่วง`, `${q.gaps.length} gaps with no data`));
  if (items.length === 0) return null;

  return (
    <details className="glass mt-1 rounded-md px-4 py-3 text-[0.85rem] shadow-sm">
      <summary className="cursor-pointer font-medium text-ink-70">
        {t(`คุณภาพข้อมูล · มี ${items.length} เรื่องที่ควรรู้`, `Data quality · ${items.length} things worth knowing`)}
      </summary>
      <ul className="mt-2 space-y-1 text-ink-70">
        {items.map((s, i) => <li key={i} className="num">· {s}</li>)}
      </ul>
    </details>
  );
}

function RangePicker({
  windows, activeKey, custom, bounds, onPreset, onCustom,
}: {
  windows: WindowSummaryWire[];
  activeKey: string;
  custom: { from: number; to: number } | null;
  bounds: { from: number; to: number };
  onPreset: (key: string) => void;
  onCustom: (from: number, to: number) => void;
}) {
  const tr = useT();
  const { prefs: { locale } } = usePrefs();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => toLocalInputValue(bounds.to - 1440));
  const [to, setTo] = useState(() => toLocalInputValue(bounds.to));
  const [err, setErr] = useState<string | null>(null);

  function apply() {
    const f = fromLocalInputValue(from);
    const t = fromLocalInputValue(to);
    if (f == null || t == null) { setErr(tr('กรอกวันเวลาให้ครบก่อน', 'Fill in both dates first.')); return; }
    if (t <= f) { setErr(tr('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม', 'The end must come after the start.')); return; }
    if (t < bounds.from || f > bounds.to) {
      setErr(tr(`ช่วงนี้อยู่นอกไฟล์ — ไฟล์มีข้อมูล ${fmtDateTime(bounds.from)} ถึง ${fmtDateTime(bounds.to)}`, `That window falls outside the file — it covers ${fmtDateTime(bounds.from)} to ${fmtDateTime(bounds.to)}`));
      return;
    }
    setErr(null);
    onCustom(f, t);
    setOpen(false);
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {windows.map((w) => (
          <button
            key={w.key}
            onClick={() => onPreset(w.key)}
            aria-pressed={activeKey === w.key}
            className={`num min-h-[2.6rem] rounded-full px-3.5 py-2 text-[0.85rem] transition ${
              activeKey === w.key
                ? 'bg-accent text-accent-ink shadow-sm'
                : 'border border-line bg-surface-raised/70 text-ink-70 hover:bg-surface-raised'
            }`}
          >
            {windowChip(w.key, w.labelTh, locale)}
            {w.truncated && <span className="ml-1 opacity-70">*</span>}
          </button>
        ))}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-pressed={activeKey === '__custom'}
          className={`inline-flex min-h-[2.6rem] items-center gap-1.5 rounded-full px-3.5 py-2 text-[0.85rem] transition ${
            activeKey === '__custom' ? 'bg-accent text-accent-ink shadow-sm' : 'border border-line bg-surface-raised/70 text-ink-70 hover:bg-surface-raised'
          }`}
        >
          <IconCalendar className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {custom ? `${fmtDateTime(custom.from)} – ${fmtDateTime(custom.to)}` : tr('เลือกช่วงเอง', 'Pick a window')}
          </span>
          <span className="sm:hidden">{custom ? tr('ช่วงที่เลือก', 'Custom') : tr('เลือกช่วงเอง', 'Pick a window')}</span>
        </button>
      </div>
      {windows.some((w) => w.truncated) && (
        <p className="mt-1.5 text-[0.76rem] text-ink-40">{tr('* ไฟล์สั้นกว่าช่วงที่เลือก — แสดงเท่าที่มี', '* The file is shorter than the chosen window — showing what there is')}</p>
      )}

      {open && (
        <div className="glass mt-3 rounded-md p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[0.83rem] font-medium">{tr('ตั้งแต่', 'From')}</span>
              <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
                className="num mt-1 w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.9rem] outline-none focus:border-olive" />
            </label>
            <label className="block">
              <span className="text-[0.83rem] font-medium">{tr('ถึง', 'To')}</span>
              <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
                className="num mt-1 w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.9rem] outline-none focus:border-olive" />
            </label>
          </div>
          {err && <p role="alert" className="mt-2 text-[0.83rem] text-zone-vhigh-ink">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={apply}
              className="rounded-sm bg-accent px-4 py-2 text-[0.87rem] font-medium text-accent-ink transition hover:bg-accent-dark">
              {tr('ดูช่วงนี้', 'Show this window')}
            </button>
            <button onClick={() => setOpen(false)}
              className="rounded-sm border border-line px-4 py-2 text-[0.87rem] transition hover:bg-surface-raised">
              {tr('ยกเลิก', 'Cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A custom range is summarised in the browser from numbers the server already
 * sent, except for the metrics — those come from the server's own slice via the
 * findings call, so a hand-picked window never gets a second maths implementation.
 */
function buildCustomWindow(result: AnalysisResult, from: number, to: number, locale: 'th' | 'en'): WindowSummaryWire {
  const idx: number[] = [];
  for (let i = 0; i < result.series.t.length; i++) {
    const t = result.series.t[i];
    if (t >= from && t <= to) idx.push(i);
  }
  const days = (to - from) / 1440;
  // Zooming the chart and pressing "recompute" lands here with any span at all,
  // so capture is worked out from the range itself. Reading it off a preset
  // window of the same length only ever matched when the reader used a preset,
  // and reported a confident 0% the rest of the time.
  const expected = Math.max(1, (to - from) / Math.max(1, result.quality.intervalMinutes));
  const capturePct = Math.min(100, (idx.length / expected) * 100);
  return {
    key: '__custom',
    labelTh: locale === 'en'
      ? `Selected · ${fmtDateTime(from)} – ${fmtDateTime(to)}`
      : `ช่วงที่เลือก · ${fmtDateTime(from)} – ${fmtDateTime(to)}`,  // wraps on narrow screens by design
    from,
    to,
    days,
    n: idx.length,
    capturePct,
    metrics: null,
    agp: [],
    daily: [],
    lowEvents: result.lowEvents.filter((e) => e.from >= from && e.to <= to),
    // Nothing is shown until the server has judged the range: deciding here
    // what is safe to display would be a second copy of gateForWindow, living
    // on the client, free to drift from the one that matters.
    gate: { showRangePercents: false, showCv: false, showGmi: false, showAgp: false, noteTh: null },
    truncated: false,
  };
}
