import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nesodden G16 — Kampoversikt 2026',
  description: 'Kamper og spillere for Nesodden IF G16-lagene sesong 2026',
  icons: { icon: 'https://images.fotball.no/clublogos/82.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no" className="dark">
      <body className="bg-dark-bg text-white min-h-screen">{children}</body>
    </html>
  );
}
