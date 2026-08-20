'use client';

import { SEVERITY_STYLE, label } from '@/lib/bands';
import { usePrefs, useT } from './PrefsProvider';
import { IconAlert, IconCheck, IconEye, IconInfo } from './Icons';

export interface FindingView {
  id: string;
  severity: keyof typeof SEVERITY_STYLE;
  titleTh: string;
  evidenceTh: string;
  actionTh: string | null;
  basis: 'consensus' | 'house';
}

const GLYPH: Record<FindingView['severity'], React.ReactNode> = {
  urgent: <IconAlert className="h-4 w-4" />,
  attention: <IconAlert className="h-4 w-4" />,
  watch: <IconEye className="h-4 w-4" />,
  good: <IconCheck className="h-4 w-4" />,
};

export default function Findings({ findings }: { findings: FindingView[] }) {
  const t = useT();
  const { prefs: { locale } } = usePrefs();
  if (findings.length === 0) return null;
  return (
    <ol className="space-y-3">
      {findings.map((f) => {
        const s = SEVERITY_STYLE[f.severity];
        return (
          <li key={f.id} className="glass rounded-md p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0" style={{ color: s.ink }}>{GLYPH[f.severity]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-head text-[1rem] font-medium leading-snug">{f.titleTh}</h3>
                  <span className="rounded-full px-2 py-0.5 text-[0.7rem] font-medium"
                    style={{ background: s.chip, color: s.ink }}>
                    {label(s, locale)}
                  </span>
                  {f.basis === 'house' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-[0.7rem] text-ink-40"
                      title={t('เกณฑ์นี้ทีม UP Wellness กำหนดขึ้นเอง ยังไม่ใช่มาตรฐานสากล', 'A threshold the UP Wellness team set ourselves — not an international standard')}>
                      <IconInfo className="h-3 w-3" />
                      {t('เกณฑ์ของเราเอง', 'Our own threshold')}
                    </span>
                  )}
                </div>
                <p className="num mt-1.5 text-[0.87rem] leading-relaxed text-ink-70">{f.evidenceTh}</p>
                {f.actionTh && (
                  <p className="mt-2 rounded-sm bg-surface-sunken px-3 py-2 text-[0.87rem] leading-relaxed">
                    <span className="font-medium text-olive">{t('ทำต่อ · ', 'Next · ')}</span>
                    {f.actionTh}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
