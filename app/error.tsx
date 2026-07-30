'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="glass max-w-md rounded-lg p-6 text-center shadow-md">
        <h1 className="font-head text-[1.15rem] font-semibold">หน้านี้ทำงานผิดพลาด</h1>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-70">
          ข้อมูลที่อ่านไว้ยังอยู่ในเครื่อง ลองกดโหลดใหม่ ถ้ายังไม่หายให้ส่งไฟล์เข้ามาอีกครั้ง
        </p>
        <button onClick={reset}
          className="mt-5 rounded-sm bg-olive px-5 py-3 text-[0.92rem] font-medium text-white transition hover:bg-olive-dark">
          ลองอีกครั้ง
        </button>
      </div>
    </main>
  );
}
