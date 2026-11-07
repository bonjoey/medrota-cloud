'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABELS, canManageOrgStructure, canViewUsers } from '@/lib/roles';
import { Card } from '@/components/ui';

/**
 * Dashboard — ผลส่งมอบ Sprint 1: ผู้ใช้ 4 บทบาทเข้าระบบได้และเห็นเมนูตามสิทธิ์ของตน
 * Executive Dashboard เต็มรูปแบบ (FR-R06) เป็นงาน MVP 5
 */
export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;

  const tiles: { href: string; title: string; desc: string; show: boolean }[] = [
    { href: '/schedules', title: 'ตารางเวร', desc: 'สร้างและจัดการตารางเวรประจำเดือน', show: true },
    { href: '/department-schedule', title: 'ตารางเวรหน่วยงาน', desc: 'ดูตารางเวรของหน่วยงานที่ประกาศแล้ว', show: true },
    { href: '/my-schedule', title: 'เวรของฉัน', desc: 'ดูเวรและสรุปชั่วโมงทำงานของตนเอง', show: true },
    { href: '/my-calendar', title: 'ปฏิทินของฉัน', desc: 'มุมมองปฏิทินส่วนตัว', show: true },
    { href: '/users', title: 'ผู้ใช้งาน', desc: 'จัดการบัญชีผู้ใช้และสิทธิ์', show: canViewUsers(user.role) },
    {
      href: '/scheduling-rules',
      title: 'กฎการจัดเวร',
      desc: 'กำหนดกฎ Hard/Soft Constraint',
      show: canManageOrgStructure(user.role),
    },
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold">สวัสดี, {user.fullName}</h1>
      <p className="mt-1 text-sm text-gray-500">บทบาทของคุณ: {ROLE_LABELS[user.role]}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles
          .filter((t) => t.show)
          .map((t) => (
            <Link key={t.href} href={t.href}>
              <Card className="h-full transition hover:shadow-md">
                <h2 className="font-medium">{t.title}</h2>
                <p className="mt-1 text-sm text-gray-500">{t.desc}</p>
              </Card>
            </Link>
          ))}
      </div>
    </div>
  );
}
