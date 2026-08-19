'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DEFAULT_MODEL, EMPTY, aiEnabled, clearAiConfig, loadAiConfig, maskKey, saveAiConfig, type AiConfig } from '@/lib/ai-config';
import { IconAlert, IconCheck, IconInfo, IconTrash } from './Icons';

type ModelOpt = { id: string; label: string };

export default function ConfigForm() {
  const [cfg, setCfg] = useState<AiConfig>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [models, setModels] = useState<ModelOpt[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [reveal, setReveal] = useState(false);

  useEffect(() => { setCfg(loadAiConfig()); setLoaded(true); }, []);

  function persist(next: AiConfig) {
    setCfg(next);
    if (!saveAiConfig(next)) {
      setMsg({ tone: 'warn', text: 'เบราว์เซอร์นี้ไม่ให้เก็บข้อมูลในเครื่อง (อาจอยู่ในโหมดส่วนตัว) — คีย์จะหายเมื่อปิดหน้านี้' });
    }
  }

  async function testKey() {
    setBusy(true); setMsg(null); setModels(null);
    try {
      const res = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: cfg.apiKey }),
      });
      const j = (await res.json()) as { ok: boolean; models?: ModelOpt[]; errorTh?: string };
      if (!j.ok) { setMsg({ tone: 'warn', text: j.errorTh ?? 'ตรวจคีย์ไม่สำเร็จ' }); return; }
      setModels(j.models ?? []);
      const has = (j.models ?? []).some((m) => m.id === cfg.model);
      if (!has && (j.models ?? []).length > 0) {
        // Whatever was typed is not on this key — move to the first Flash model
        // rather than leaving a name that will fail at the moment it is needed.
        persist({ ...cfg, model: j.models![0].id });
        setMsg({ tone: 'ok', text: `คีย์ใช้ได้ · เจอ ${j.models!.length} โมเดล — เปลี่ยนให้เป็น “${j.models![0].id}” เพราะชื่อเดิมไม่มีในคีย์นี้` });
      } else {
        setMsg({ tone: 'ok', text: `คีย์ใช้ได้ · เจอ ${(j.models ?? []).length} โมเดลที่เรียกได้` });
      }
    } catch {
      setMsg({ tone: 'warn', text: 'ต่อกับเซิร์ฟเวอร์ไม่ได้' });
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;
  const on = aiEnabled(cfg);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6">
        <Link href="/" className="text-[0.85rem] text-ink-40 transition hover:text-olive">← กลับหน้าวิเคราะห์</Link>
        <h1 className="mt-2 font-head text-[1.4rem] font-semibold tracking-tight">ตั้งค่า</h1>
        <p className="mt-1 text-[0.88rem] leading-relaxed text-ink-70">
          ใส่ API key ของ Google Gemini เพื่อเปิดใช้ “สรุปด้วย AI” ในหน้าวิเคราะห์
          <b> ไม่ใส่ก็ใช้งานได้ครบทุกอย่าง</b> — ข้อค้นพบ รูปร่างกราฟ และใบสรุปให้เคส คำนวณจากเกณฑ์ตรง ๆ ไม่ได้ใช้ AI
        </p>
      </header>

      <section className="glass rounded-lg p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-head text-[1.02rem] font-semibold">Google Gemini API key</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-[0.74rem] font-medium ${
            on ? 'bg-zone-in/12 text-zone-in-ink' : 'bg-surface-sunken text-ink-40'}`}>
            {on ? 'เปิดใช้อยู่' : 'ยังไม่เปิดใช้'}
          </span>
        </div>

        <label className="mt-4 block">
          <span className="text-[0.85rem] font-medium">API key</span>
          <div className="mt-1 flex gap-2">
            <input
              type={reveal ? 'text' : 'password'}
              value={cfg.apiKey}
              onChange={(e) => persist({ ...cfg, apiKey: e.target.value })}
              placeholder="วางคีย์จาก Google AI Studio"
              autoComplete="off" spellCheck={false}
              className="num min-h-[2.75rem] w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.92rem] outline-none focus:border-olive"
            />
            <button onClick={() => setReveal((v) => !v)} type="button"
              className="min-h-[2.75rem] shrink-0 rounded-sm border border-line px-3 text-[0.82rem] transition hover:bg-surface-raised">
              {reveal ? 'ซ่อน' : 'ดู'}
            </button>
          </div>
          {cfg.apiKey && !reveal && (
            <span className="num mt-1 block text-[0.76rem] text-ink-40">{maskKey(cfg.apiKey)}</span>
          )}
        </label>

        <label className="mt-4 block">
          <span className="text-[0.85rem] font-medium">โมเดล</span>
          {models && models.length > 0 ? (
            <select value={cfg.model} onChange={(e) => persist({ ...cfg, model: e.target.value })}
              className="mt-1 min-h-[2.75rem] w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.92rem] outline-none focus:border-olive">
              {models.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.id}</option>)}
            </select>
          ) : (
            <input value={cfg.model} onChange={(e) => persist({ ...cfg, model: e.target.value })}
              placeholder={DEFAULT_MODEL} autoComplete="off" spellCheck={false}
              className="num mt-1 min-h-[2.75rem] w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.92rem] outline-none focus:border-olive" />
          )}
          <span className="mt-1 block text-[0.78rem] leading-relaxed text-ink-40">
            กด “ตรวจคีย์” แล้วระบบจะดึงรายชื่อโมเดลที่คีย์นี้เรียกได้จริงมาให้เลือก —
            ชื่อโมเดลของ Google เปลี่ยนบ่อย การพิมพ์เองไว้เฉย ๆ มักพังตอนที่ต้องใช้จริง
          </span>
        </label>

        <label className="mt-4 flex items-start gap-2.5 rounded-sm bg-surface-sunken px-3 py-3 text-[0.85rem] leading-relaxed">
          <input type="checkbox" checked={cfg.consented}
            onChange={(e) => persist({ ...cfg, consented: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-olive" />
          <span>
            <b>เข้าใจแล้วว่าข้อมูลอะไรถูกส่งออกไป</b> — เมื่อกดสรุปด้วย AI ระบบจะส่ง
            <b> ตัวเลขสรุปเท่านั้น</b> (ค่าเฉลี่ย · % เวลาในแต่ละช่วง · CV · จำนวนรูปร่าง พุ่ง/กว้าง/ค้าง/ตก · ข้อค้นพบตามเกณฑ์)
            ไปที่ Google <b>ไม่ส่งค่าน้ำตาลรายจุด ไม่ส่งชื่อเคส ไม่ส่งไฟล์</b>
          </span>
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={testKey} disabled={busy || cfg.apiKey.trim().length < 10}
            className="min-h-[2.75rem] flex-1 rounded-sm bg-accent px-4 py-2 text-[0.88rem] font-medium text-accent-ink transition hover:bg-accent-dark disabled:opacity-40 sm:flex-none">
            {busy ? 'กำลังตรวจ…' : 'ตรวจคีย์ + ดึงรายชื่อโมเดล'}
          </button>
          <button onClick={() => { clearAiConfig(); setCfg(EMPTY); setModels(null); setMsg({ tone: 'ok', text: 'ลบคีย์ออกจากเครื่องนี้แล้ว' }); }}
            disabled={!cfg.apiKey}
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-sm border border-line px-4 py-2 text-[0.88rem] transition hover:bg-surface-raised disabled:opacity-40 sm:flex-none">
            <IconTrash className="h-3.5 w-3.5" /> ลบคีย์
          </button>
        </div>

        {msg && (
          <p role="status" className={`mt-3 flex items-start gap-2 rounded-sm px-3 py-2 text-[0.86rem] leading-relaxed ${
            msg.tone === 'ok' ? 'bg-zone-in/10 text-zone-in-ink' : 'bg-zone-vhigh/10 text-zone-vhigh-ink'}`}>
            {msg.tone === 'ok' ? <IconCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            {msg.text}
          </p>
        )}
      </section>

      <section className="glass mt-4 rounded-lg p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-head text-[1.02rem] font-semibold">
          <IconInfo className="h-4 w-4 text-ink-40" /> คีย์เก็บไว้ที่ไหน
        </h2>
        <ul className="mt-2 space-y-1.5 text-[0.86rem] leading-relaxed text-ink-70">
          <li>· เก็บใน <b>เบราว์เซอร์เครื่องนี้เท่านั้น</b> ไม่ได้บันทึกลงเซิร์ฟเวอร์ ไม่มีฐานข้อมูล</li>
          <li>· เปลี่ยนเครื่องหรือเปลี่ยนเบราว์เซอร์ ต้องใส่ใหม่ · ล้างข้อมูลเบราว์เซอร์แล้วคีย์หาย</li>
          <li>· ตอนกดสรุป คีย์จะ<b>ผ่านเซิร์ฟเวอร์ของเรา</b>ไปหา Google หนึ่งครั้ง แล้วทิ้ง ไม่เก็บ ไม่ log
            <span className="block text-ink-40">(ที่ไม่ยิงจากเบราว์เซอร์ตรง ๆ เพราะคำสั่งที่ส่งไปมีเกณฑ์การตีความอยู่ ซึ่งเป็นสิ่งเดียวที่ต้องไม่หลุดไปฝั่งผู้ใช้)</span>
          </li>
          <li>· <b>โควตาและค่าใช้จ่ายเป็นของคีย์ที่ใส่</b> — ใครใส่คีย์ คนนั้นจ่าย</li>
        </ul>
      </section>

      <p className="mt-4 text-center text-[0.78rem] leading-relaxed text-ink-40">
        AI ใช้เรียบเรียงคำพูดเปิดบทสนทนาเท่านั้น · ข้อค้นพบ ตัวเลข และรูปร่างกราฟทั้งหมด
        คำนวณจากเกณฑ์ในระบบ ไม่ได้มาจาก AI และไม่เปลี่ยนตามคำตอบของ AI
      </p>
    </div>
  );
}
