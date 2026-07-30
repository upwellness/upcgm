'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function GateForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = params.get('next');
  // Only same-site paths. Without this check `?next=https://evil.example` turns
  // our login page into someone else's redirector.
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode: code }),
      });
      const json = (await res.json().catch(() => ({}))) as { messageTh?: string };
      if (!res.ok) {
        setError(json.messageTh ?? 'เข้าใช้งานไม่สำเร็จ');
        setBusy(false);
        return;
      }
      router.replace(dest);
      // Deliberately leave busy=true: the route change is not instant and a
      // re-enabled button invites a second submit that races the first.
    } catch {
      setError('เชื่อมต่อไม่ได้ ลองตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass rounded-lg p-6 shadow-md">
      <label htmlFor="passcode" className="block text-[0.92rem] font-medium">
        รหัสเข้าใช้งาน
      </label>
      <p className="mt-1 text-[0.82rem] text-ink-40">ทีมงานเป็นผู้ออกรหัสให้ — ไม่ต้องใช้ API key ของตัวเอง</p>
      <input
        id="passcode"
        name="passcode"
        type="password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="one-time-code"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        required
        aria-describedby={error ? 'gate-error' : undefined}
        aria-invalid={error ? true : undefined}
        className="num mt-3 w-full rounded-sm border border-line bg-white/85 px-4 py-3 text-[1.05rem] tracking-[0.14em] outline-none placeholder:tracking-normal placeholder:text-ink-40 focus:border-olive"
        placeholder="กรอกรหัสที่ได้รับ"
      />
      {error && (
        <p id="gate-error" role="alert" className="mt-3 rounded-sm bg-zone-vhigh/10 px-3 py-2 text-[0.88rem] text-zone-vhigh-ink">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !code.trim()}
        className="mt-5 w-full rounded-sm bg-olive px-4 py-3 font-head text-[1rem] font-medium text-white shadow-sm transition hover:bg-olive-dark disabled:cursor-not-allowed disabled:opacity-45"
      >
        {busy ? 'กำลังตรวจรหัส…' : 'เข้าใช้งาน'}
      </button>
    </form>
  );
}
