/**
 * Inline icons rather than an icon package: eleven glyphs do not justify a
 * dependency, and these ship in the HTML so nothing pops in late on a slow
 * connection. Stroke-based and currentColor so they inherit contrast decisions.
 */

type P = { className?: string };
const base = 'shrink-0';

function Svg({ className, children, filled = false }: P & { children: React.ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${base} ${className ?? 'h-4 w-4'}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconTarget = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></Svg>
);
export const IconAverage = (p: P) => (
  <Svg {...p}><path d="M3 12h4l2.5-6 3.5 12 2.5-6h5.5" /></Svg>
);
export const IconWave = (p: P) => (
  <Svg {...p}><path d="M3 14c2.5 0 2.5-6 5-6s2.5 6 5 6 2.5-6 5-6 1.8 3 3 3" /></Svg>
);
export const IconArrowDown = (p: P) => (
  <Svg {...p}><path d="M12 5v13" /><path d="M6.5 12.5 12 18l5.5-5.5" /></Svg>
);
export const IconArrowUp = (p: P) => (
  <Svg {...p}><path d="M12 19V6" /><path d="M6.5 11.5 12 6l5.5 5.5" /></Svg>
);
export const IconLab = (p: P) => (
  <Svg {...p}><path d="M9 3h6" /><path d="M10 3v6.5L5.5 17A2.6 2.6 0 0 0 7.8 21h8.4a2.6 2.6 0 0 0 2.3-4L14 9.5V3" /><path d="M7.5 15h9" /></Svg>
);
export const IconMoon = (p: P) => (
  <Svg {...p}><path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" /></Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>
);
export const IconCalendar = (p: P) => (
  <Svg {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Svg>
);
export const IconUpload = (p: P) => (
  <Svg {...p}><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11A2.5 2.5 0 0 0 20 18.5V15" /></Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}><path d="M12 4v12" /><path d="M7 11l5 5 5-5" /><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11A2.5 2.5 0 0 0 20 18.5V15" /></Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}><path d="M4 7h16" /><path d="M9.5 7V4.8h5V7" /><path d="M6.5 7l.9 12.2A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.8L17.5 7" /><path d="M10.5 11v6M13.5 11v6" /></Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}><path d="M12 3.8 21 19.2H3L12 3.8Z" /><path d="M12 9.5v4.2" /><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none" /></Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.2 12.3l2.6 2.6 5-5.4" /></Svg>
);
export const IconEye = (p: P) => (
  <Svg {...p}><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></Svg>
);
export const IconSparkle = (p: P) => (
  <Svg {...p}><path d="M12 3.5l1.8 4.9 4.9 1.8-4.9 1.8L12 16.9l-1.8-4.9L5.3 10.2l4.9-1.8L12 3.5Z" /><path d="M18.5 16.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z" /></Svg>
);
export const IconImage = (p: P) => (
  <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.7" /><path d="M4.2 18l4.6-4.6a2 2 0 0 1 2.8 0L20 21" /></Svg>
);
export const IconInfo = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.2" /><circle cx="12" cy="8" r=".95" fill="currentColor" stroke="none" /></Svg>
);
