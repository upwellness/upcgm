'use client';

import { useEffect, useState } from 'react';
import { usePrefs, useT } from './PrefsProvider';
import Link from 'next/link';
import { DEFAULT_MODEL, EMPTY, aiEnabled, clearAiConfig, loadAiConfig, maskKey, saveAiConfig, type AiConfig } from '@/lib/ai-config';
import { IconAlert, IconCheck, IconInfo, IconTrash } from './Icons';

type ModelOpt = { id: string; label: string };

export default function ConfigForm() {
  const t = useT();
  const { prefs: { locale } } = usePrefs();
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
      setMsg({ tone: 'warn', text: t('เบราว์เซอร์นี้ไม่ให้เก็บข้อมูลในเครื่อง (อาจอยู่ในโหมดส่วนตัว) — คีย์จะหายเมื่อปิดหน้านี้', 'This browser will not store data locally (private mode, most likely) — the key will be lost when this page closes.') });
    }
  }

  async function testKey() {
    setBusy(true); setMsg(null); setModels(null);
    try {
      const res = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-upcgm-locale': locale },
        body: JSON.stringify({ apiKey: cfg.apiKey }),
      });
      const j = (await res.json()) as { ok: boolean; models?: ModelOpt[]; errorTh?: string };
      if (!j.ok) { setMsg({ tone: 'warn', text: j.errorTh ?? t('ตรวจคีย์ไม่สำเร็จ', 'Could not verify the key.') }); return; }
      setModels(j.models ?? []);
      const has = (j.models ?? []).some((m) => m.id === cfg.model);
      if (!has && (j.models ?? []).length > 0) {
        // Whatever was typed is not on this key — move to the first Flash model
        // rather than leaving a name that will fail at the moment it is needed.
        persist({ ...cfg, model: j.models![0].id });
        setMsg({ tone: 'ok', text: t(`คีย์ใช้ได้ · เจอ ${j.models!.length} โมเดล — เปลี่ยนให้เป็น “${j.models![0].id}” เพราะชื่อเดิมไม่มีในคีย์นี้`, `Key works · found ${j.models!.length} models — switched to “${j.models![0].id}” because the previous name is not available on this key.`) });
      } else {
        setMsg({ tone: 'ok', text: t(`คีย์ใช้ได้ · เจอ ${(j.models ?? []).length} โมเดลที่เรียกได้`, `Key works · ${(j.models ?? []).length} models reachable.`) });
      }
    } catch {
      setMsg({ tone: 'warn', text: t('ต่อกับเซิร์ฟเวอร์ไม่ได้', 'Could not reach the server.') });
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;
  const on = aiEnabled(cfg);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6">
        <Link href="/" className="text-[0.85rem] text-ink-40 transition hover:text-olive">{t('← กลับหน้าวิเคราะห์', '← Back to the analysis')}</Link>
        <h1 className="mt-2 font-head text-[1.4rem] font-semibold tracking-tight">{t('ตั้งค่า', 'Settings')}</h1>
        <p className="mt-1 text-[0.88rem] leading-relaxed text-ink-70">
          {t('ใส่ API key ของ Google Gemini เพื่อเปิดใช้ “สรุปด้วย AI” ในหน้าวิเคราะห์', 'Add a Google Gemini API key to switch on the AI summary in the analysis view.')}
          <b>{t(' ไม่ใส่ก็ใช้งานได้ครบทุกอย่าง', ' Everything works without one.')}</b>{t(' — ข้อค้นพบ รูปร่างกราฟ และใบสรุปให้เคส คำนวณจากเกณฑ์ตรง ๆ ไม่ได้ใช้ AI', ' Findings, curve shapes and the client handout are all computed from the thresholds, not by AI.')}
        </p>
      </header>

      <section className="glass rounded-lg p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-head text-[1.02rem] font-semibold">Google Gemini API key</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-[0.74rem] font-medium ${
            on ? 'bg-zone-in/12 text-zone-in-ink' : 'bg-surface-sunken text-ink-40'}`}>
            {on ? t('เปิดใช้อยู่', 'On') : t('ยังไม่เปิดใช้', 'Off')}
          </span>
        </div>

        <label className="mt-4 block">
          <span className="text-[0.85rem] font-medium">API key</span>
          <div className="mt-1 flex gap-2">
            <input
              type={reveal ? 'text' : 'password'}
              value={cfg.apiKey}
              onChange={(e) => persist({ ...cfg, apiKey: e.target.value })}
              placeholder={t('วางคีย์จาก Google AI Studio', 'Paste a key from Google AI Studio')}
              autoComplete="off" spellCheck={false}
              className="num min-h-[2.75rem] w-full rounded-sm border border-line bg-surface-raised px-3 py-2 text-[0.92rem] outline-none focus:border-olive"
            />
            <button onClick={() => setReveal((v) => !v)} type="button"
              className="min-h-[2.75rem] shrink-0 rounded-sm border border-line px-3 text-[0.82rem] transition hover:bg-surface-raised">
              {reveal ? t('ซ่อน', 'Hide') : t('ดู', 'Show')}
            </button>
          </div>
          {cfg.apiKey && !reveal && (
            <span className="num mt-1 block text-[0.76rem] text-ink-40">{maskKey(cfg.apiKey)}</span>
          )}
        </label>

        <label className="mt-4 block">
          <span className="text-[0.85rem] font-medium">{t('โมเดล', 'Model')}</span>
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
            {t('กด “ตรวจคีย์” แล้วระบบจะดึงรายชื่อโมเดลที่คีย์นี้เรียกได้จริงมาให้เลือก —', 'Press “Verify key” and the list of models this key can actually reach is fetched for you —')}
            {t('ชื่อโมเดลของ Google เปลี่ยนบ่อย การพิมพ์เองไว้เฉย ๆ มักพังตอนที่ต้องใช้จริง', 'Google renames models often, and a hand-typed name tends to break at the moment you need it.')}
          </span>
        </label>

        <label className="mt-4 flex items-start gap-2.5 rounded-sm bg-surface-sunken px-3 py-3 text-[0.85rem] leading-relaxed">
          <input type="checkbox" checked={cfg.consented}
            onChange={(e) => persist({ ...cfg, consented: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-olive" />
          <span>
            <b>{t('เข้าใจแล้วว่าข้อมูลอะไรถูกส่งออกไป', 'I understand what leaves this machine')}</b>{t(' — เมื่อกดสรุปด้วย AI ระบบจะส่ง', ' — pressing the AI summary sends')}
            <b>{t(' ตัวเลขสรุปเท่านั้น', ' summary numbers only')}</b>{t(' (ค่าเฉลี่ย · % เวลาในแต่ละช่วง · CV · จำนวนรูปร่าง พุ่ง/กว้าง/ค้าง/ตก · ข้อค้นพบตามเกณฑ์)', ' (average · % of time in each band · CV · counts of Spike/Wide/Stuck/Crash · the threshold findings)')}
            {t('ไปที่ Google ', 'to Google. ')}<b>{t('ไม่ส่งค่าน้ำตาลรายจุด ไม่ส่งชื่อเคส ไม่ส่งไฟล์', 'No individual readings, no client name, no file.')}</b>
          </span>
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={testKey} disabled={busy || cfg.apiKey.trim().length < 10}
            className="min-h-[2.75rem] flex-1 rounded-sm bg-accent px-4 py-2 text-[0.88rem] font-medium text-accent-ink transition hover:bg-accent-dark disabled:opacity-40 sm:flex-none">
            {busy ? t('กำลังตรวจ…', 'Checking…') : t('ตรวจคีย์ + ดึงรายชื่อโมเดล', 'Verify key + fetch models')}
          </button>
          <button onClick={() => { clearAiConfig(); setCfg(EMPTY); setModels(null); setMsg({ tone: 'ok', text: t('ลบคีย์ออกจากเครื่องนี้แล้ว', 'Key removed from this device.') }); }}
            disabled={!cfg.apiKey}
            className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-sm border border-line px-4 py-2 text-[0.88rem] transition hover:bg-surface-raised disabled:opacity-40 sm:flex-none">
            <IconTrash className="h-3.5 w-3.5" /> {t('ลบคีย์', 'Delete key')}
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
          <IconInfo className="h-4 w-4 text-ink-40" /> {t('คีย์เก็บไว้ที่ไหน', 'Where the key is kept')}
        </h2>
        <ul className="mt-2 space-y-1.5 text-[0.86rem] leading-relaxed text-ink-70">
          <li>{t('· เก็บใน ', '· Stored in ')}<b>{t('เบราว์เซอร์เครื่องนี้เท่านั้น', 'this browser only')}</b>{t(' ไม่ได้บันทึกลงเซิร์ฟเวอร์ ไม่มีฐานข้อมูล', ' — never written to a server, and there is no database.')}</li>
          <li>{t('· เปลี่ยนเครื่องหรือเปลี่ยนเบราว์เซอร์ ต้องใส่ใหม่ · ล้างข้อมูลเบราว์เซอร์แล้วคีย์หาย', '· A different device or browser needs the key again · clearing browser data removes it.')}</li>
          <li>{t('· ตอนกดสรุป คีย์จะ', '· On each summary the key passes ')}<b>{t('ผ่านเซิร์ฟเวอร์ของเรา', 'through our server')}</b>{t('ไปหา Google หนึ่งครั้ง แล้วทิ้ง ไม่เก็บ ไม่ log', ' to Google once, then is discarded — not stored, not logged.')}
            <span className="block text-ink-40">{t('(ที่ไม่ยิงจากเบราว์เซอร์ตรง ๆ เพราะคำสั่งที่ส่งไปมีเกณฑ์การตีความอยู่ ซึ่งเป็นสิ่งเดียวที่ต้องไม่หลุดไปฝั่งผู้ใช้)', '(It does not go straight from the browser because the prompt carries the interpretation thresholds, which are the one thing that must not reach the client.)')}</span>
          </li>
          <li>· <b>{t('โควตาและค่าใช้จ่ายเป็นของคีย์ที่ใส่', 'Quota and cost belong to the key that was entered')}</b>{t(' — ใครใส่คีย์ คนนั้นจ่าย', ' — whoever adds the key pays.')}</li>
        </ul>
      </section>

      <p className="mt-4 text-center text-[0.78rem] leading-relaxed text-ink-40">
        {t(
          'AI ใช้เรียบเรียงคำพูดเปิดบทสนทนาเท่านั้น · ข้อค้นพบ ตัวเลข และรูปร่างกราฟทั้งหมด คำนวณจากเกณฑ์ในระบบ ไม่ได้มาจาก AI และไม่เปลี่ยนตามคำตอบของ AI',
          'AI only phrases the opening of a conversation. Every finding, number and curve shape is computed from the thresholds in this system, not by AI, and does not change with what the AI says.',
        )}
      </p>
    </div>
  );
}
