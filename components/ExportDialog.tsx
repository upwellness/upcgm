'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrefs, useT } from './PrefsProvider';
import type { MealMarker, Reading, WindowSummaryWire } from '@/lib/types';
import A4Sheet from './A4Sheet';
import type { PatternSnapshotView } from './PatternPanel';
import type { FindingView } from './Findings';
import { IconImage } from './Icons';

/** A4 at 96 dpi. Mirrors the fixed size in A4Sheet.tsx. */
const SHEET_W = 794;
const SHEET_H = 1123;

interface Props {
  open: boolean;
  onClose: () => void;
  w: WindowSummaryWire;
  readings: Reading[];
  markers: MealMarker[];
  findings: FindingView[];
  headlineTh: string;
  limitationsTh: string[];
  narrative: string | null;
  patterns: PatternSnapshotView | null;
}

export default function ExportDialog(props: Props) {
  const t = useT();
  const { prefs: { locale } } = usePrefs();
  const { open, onClose } = props;
  const sheetRef = useRef<HTMLDivElement>(null);
  const [clientName, setClientName] = useState('');
  const [coachNote, setCoachNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const previewRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);

  // The sheet is a fixed 794px wide. Rather than making it responsive — which
  // would mean the export no longer matches the preview — scale the preview down
  // to whatever space the screen has.
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const el = previewRef.current;
      if (!el) return;
      setScale(Math.min(1, (el.clientWidth - 8) / SHEET_W));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function savePng() {
    const node = sheetRef.current;
    const holder = transformRef.current;
    if (!node || busy) return;
    setBusy(true);
    setError(null);
    // html2canvas honours the CSS transform on the ancestor, so capturing while
    // the preview is scaled to fit a phone produced a 686px-wide image. The page
    // handed to a case must be full resolution whatever screen the coach is on,
    // so the scale comes off for the duration of the capture.
    const previousTransform = holder?.style.transform ?? '';
    try {
      if (holder) holder.style.transform = 'none';
      // Loaded on demand: html2canvas is ~200KB and most sessions never export.
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        width: SHEET_W,
        height: Math.max(SHEET_H, node.scrollHeight),
        windowWidth: SHEET_W + 60,
      });
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('no blob');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `cgm-${clientName.trim() ? clientName.trim().replace(/\s+/g, '-') : 'report'}-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      setError(t('บันทึกรูปไม่สำเร็จบนเบราว์เซอร์นี้ — กด “สั่งพิมพ์” แล้วเลือกบันทึกเป็น PDF ได้เหมือนกัน', 'Saving an image did not work in this browser — use “Print” and choose Save as PDF instead.'));
    } finally {
      if (holder) holder.style.transform = previousTransform;
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/45 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true"
      aria-label={t('สร้างรายงานหนึ่งหน้าให้เคส', 'Build a one-page report for the client')}>
      <div className="mx-auto max-w-5xl">
        <div className="glass no-print sticky top-0 z-10 mb-4 flex flex-wrap items-end gap-3 rounded-lg p-4 shadow-lg">
          <label className="min-w-[10rem] flex-1">
            <span className="text-[0.8rem] font-medium">{t('ชื่อเรียกของเคส (ไม่จำเป็น)', 'What to call the client (optional)')}</span>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} maxLength={40}
              placeholder={t('เช่น พี่แดง', 'e.g. Dang')}
              className="mt-1 w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.9rem] outline-none focus:border-olive" />
          </label>
          <label className="min-w-[14rem] flex-[2]">
            <span className="text-[0.8rem] font-medium">{t('บันทึกจากโค้ช (ไม่จำเป็น)', 'Note from the coach (optional)')}</span>
            <input value={coachNote} onChange={(e) => setCoachNote(e.target.value)} maxLength={200}
              placeholder={t('เช่น อาทิตย์หน้าลองเดินหลังมื้อเย็น 15 นาที แล้วส่งไฟล์ใหม่มาดูกัน', 'e.g. next week, try a 15-minute walk after dinner and send a fresh file')}
              className="mt-1 w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.9rem] outline-none focus:border-olive" />
          </label>
          <div className="flex w-full gap-2 sm:w-auto">
            <button onClick={savePng} disabled={busy}
              className="inline-flex min-h-[2.9rem] flex-1 items-center justify-center gap-1.5 rounded-sm bg-accent px-4 py-2.5 text-[0.88rem] font-medium text-accent-ink transition hover:bg-accent-dark disabled:opacity-50 sm:flex-none">
              <IconImage className="h-4 w-4" />
              {busy ? t('กำลังสร้างรูป…', 'Building the image…') : t('บันทึกเป็นรูป', 'Save as image')}
            </button>
            <button onClick={() => window.print()}
              className="min-h-[2.9rem] rounded-sm border border-line bg-surface-raised/80 px-4 py-2.5 text-[0.88rem] transition hover:bg-surface-raised">
              {t('สั่งพิมพ์', 'Print')}
            </button>
            <button onClick={onClose}
              className="min-h-[2.9rem] rounded-sm border border-line bg-surface-raised/80 px-4 py-2.5 text-[0.88rem] transition hover:bg-surface-raised">
              {t('ปิด', 'Close')}
            </button>
          </div>
          {error && <p role="alert" className="w-full text-[0.85rem] text-zone-vhigh-ink">{error}</p>}
          <p className="w-full text-[0.78rem] leading-relaxed text-ink-40">
            {t('รายงานหน้านี้ไม่มีชื่อสินค้าและไม่มีราคา — ออกแบบให้เคสเอาไปคุยกับแพทย์ได้', 'This page carries no product names and no prices — it is built for the client to take to a doctor.')}
          </p>
        </div>

        <div ref={previewRef} className="mb-6">
          {/* Scaled preview; the exported node itself keeps its true 794px size. */}
          <div style={{ height: SHEET_H * scale + 24, overflow: 'hidden' }}>
            <div ref={transformRef} style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: SHEET_W }}>
              <div className="shadow-lg">
                <A4Sheet
                  ref={sheetRef}
                  clientName={clientName}
                  coachNote={coachNote}
                  w={props.w}
                  readings={props.readings}
                  markers={props.markers}
                  findings={props.findings}
                  headlineTh={props.headlineTh}
                  limitationsTh={props.limitationsTh}
                  narrative={props.narrative}
                  patterns={props.patterns}
                  // The date the handout was printed. Thai keeps the Buddhist
                  // year the rest of the Thai page uses; English must not carry it.
                  generatedAtLabel={new Date().toLocaleDateString(locale === 'en' ? 'en-GB' : 'th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
