import type { Metadata } from 'next';
import './globals.css';
import { AccessGate } from '@/components/access-gate';
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'OpenGame · 把想法变成游戏',
  description: '描述你的玩法，在线试玩，用对话不断打磨。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AccessGate>{children}</AccessGate>
      </body>
    </html>
  );
}
