'use client';

import { useRef, useState } from 'react';
import type { AnalysisResult } from '@/lib/types';
import { IconAlert, IconUpload } from './Icons';

export default function Uploader({ onResult }: { onResult: (r: AnalysisResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/analyse', { method: 'POST', body: form });
      if (res.status === 401) {
        // Only reachable if the passcode gate is switched back on in
        // middleware.ts and the session expired while the tab sat open.
        setError('เซสชันหมดอายุ — โหลดหน้านี้ใหม่อีกครั้ง');
        return;
      }
      const json = (await res.json().catch(() => ({}))) as Partial<AnalysisResult> & { messageTh?: string };
      if (!res.ok) {
        setError(json.messageTh ?? 'อ่านไฟล์ไม่สำเร็จ');
        return;
      }
      onResult(json as AnalysisResult);
    } catch {
      setError('ส่งไฟล์ไม่สำเร็จ ลองตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="mb-7 text-center">
        <h1 className="font-head text-[1.5rem] font-semibold tracking-tight sm:text-[1.75rem]">CGM Analyser</h1>
        <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-70">
          ส่งไฟล์ที่ดาวน์โหลดจากแอปเครื่องวัดน้ำตาลต่อเนื่องเข้ามา แล้วอ่านผลไปคุยกับเคสได้เลย
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void send(f);
        }}
        className={`glass rounded-lg p-6 text-center shadow-md transition sm:p-9 ${dragging ? 'ring-2 ring-olive' : ''}`}
      >
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent/10 text-olive">
          <IconUpload className="h-6 w-6" />
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full rounded-sm bg-accent px-5 py-3.5 font-head text-[1rem] font-medium text-accent-ink shadow-sm transition hover:bg-accent-dark disabled:opacity-50 sm:w-auto"
        >
          {busy ? 'กำลังอ่านไฟล์…' : 'เลือกไฟล์จากเครื่อง'}
        </button>
        <p className="mt-3 text-[0.85rem] text-ink-40">
          รับไฟล์ .xlsx และ .csv ขนาดไม่เกิน 5 MB
          <span className="hidden sm:inline"> · ลากไฟล์มาวางที่นี่ก็ได้</span>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void send(f);
          }}
        />
      </div>

      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-zone-vhigh/10 px-4 py-3 text-[0.88rem] leading-relaxed text-zone-vhigh-ink">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-7 rounded-md border border-line bg-surface-raised/50 p-4 text-[0.85rem] leading-relaxed text-ink-70">
        <p className="font-medium text-ink">ไฟล์ไปไหน</p>
        <p className="mt-1.5">
          ไฟล์ถูกอ่านในเซิร์ฟเวอร์แล้วส่งผลกลับมาทันที ไม่มีการเก็บไฟล์หรือข้อมูลน้ำตาลไว้ในระบบ
          มื้ออาหารที่โค้ชบันทึกเก็บอยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น
        </p>
      </div>
    </div>
  );
}
