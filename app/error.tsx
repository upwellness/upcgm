'use client';

import { useT } from '@/components/PrefsProvider';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = useT();
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="glass max-w-md rounded-lg p-6 text-center shadow-md">
        <h1 className="font-head text-[1.15rem] font-semibold">{t('หน้านี้ทำงานผิดพลาด', 'Something went wrong on this page')}</h1>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-70">
          {t('ข้อมูลที่อ่านไว้ยังอยู่ในเครื่อง ลองกดโหลดใหม่ ถ้ายังไม่หายให้ส่งไฟล์เข้ามาอีกครั้ง', 'What was read is still on this device. Try reloading; if it persists, send the file again.')}
        </p>
        <button onClick={reset}
          className="mt-5 rounded-sm bg-accent px-5 py-3 text-[0.92rem] font-medium text-accent-ink transition hover:bg-accent-dark">
          {t('ลองอีกครั้ง', 'Try again')}
        </button>
      </div>
    </main>
  );
}
