import type { Metadata, Viewport } from 'next';
import { Kanit, Sarabun } from 'next/font/google';
import './globals.css';

// Self-hosted by next/font at build time — no request to Google at runtime, so
// the page renders the same on a clinic wifi that blocks third-party fonts.
const kanit = Kanit({
  subsets: ['thai', 'latin'],
  weight: ['500', '600', '700'],
  variable: '--font-kanit',
  display: 'swap',
});
const sarabun = Sarabun({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sarabun',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CGM Analyser · UP Wellness',
  description: 'อ่านผลเครื่องวัดน้ำตาลต่อเนื่อง (CGM) สำหรับโค้ช UP Wellness',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never lock zoom on a page that shows numbers to someone over fifty.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${kanit.variable} ${sarabun.variable}`}>
      <body className="font-body text-ink">{children}</body>
    </html>
  );
}
