import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MedRota Cloud — บริหารจัดการเวรโรงพยาบาล',
  description: 'ระบบบริหารจัดการเวรโรงพยาบาล พร้อม AI จัดเวร คาดการณ์กำลังคน และประเมินความเหนื่อยล้า',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
