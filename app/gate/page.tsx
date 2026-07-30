import { Suspense } from 'react';
import GateForm from '@/components/GateForm';

export const metadata = { title: 'เข้าใช้งาน · CGM Analyser' };

export default function GatePage() {
  return (
    <main className="min-h-dvh grid place-items-center px-5 py-12">
      <div className="w-full max-w-[26rem]">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-olive text-white shadow-md">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 14h3.5l2-5 3 10 2.5-7 1.8 4H21" />
            </svg>
          </div>
          <h1 className="font-head text-[1.55rem] font-semibold tracking-tight">CGM Analyser</h1>
          <p className="mt-1.5 text-[0.95rem] text-ink-70">เครื่องมือของโค้ช UP Wellness สำหรับอ่านผลเครื่องวัดน้ำตาลต่อเนื่อง</p>
        </div>
        <Suspense fallback={null}>
          <GateForm />
        </Suspense>
        <p className="mt-6 text-center text-[0.82rem] leading-relaxed text-ink-40">
          เครื่องมือนี้ช่วยอ่านข้อมูลเพื่อพูดคุยเรื่องพฤติกรรม<br />ไม่ใช่การวินิจฉัยโรค และไม่ใช้แทนคำแนะนำของแพทย์
        </p>
      </div>
    </main>
  );
}
