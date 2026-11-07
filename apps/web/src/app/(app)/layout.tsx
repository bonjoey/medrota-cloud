'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABELS, canManageHospitalSettings, canManageOrgStructure, canViewUsers } from '@/lib/roles';
import type { Role } from '@/lib/api-client';

interface NavItem {
  href: string;
  label: string;
  show: (role: Role) => boolean;
}

/** FR-A03: เมนู Dynamic ตามบทบาท — แสดงเฉพาะเมนูที่ Role นั้นมีสิทธิ์ */
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'หน้าหลัก', show: () => true },
  { href: '/schedules', label: 'ตารางเวร', show: () => true },
  { href: '/department-schedule', label: 'ตารางเวรหน่วยงาน', show: () => true },
  { href: '/my-schedule', label: 'เวรของฉัน', show: () => true },
  { href: '/my-calendar', label: 'ปฏิทินของฉัน', show: () => true },
  { href: '/users', label: 'ผู้ใช้งาน', show: canViewUsers },
  { href: '/wards', label: 'หอผู้ป่วย', show: canManageOrgStructure },
  { href: '/departments', label: 'แผนก', show: canManageOrgStructure },
  { href: '/shift-types', label: 'ประเภทเวร', show: canManageOrgStructure },
  { href: '/scheduling-rules', label: 'กฎการจัดเวร', show: canManageOrgStructure },
  { href: '/hospital-settings', label: 'ตั้งค่าโรงพยาบาล', show: canManageHospitalSettings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">กำลังโหลด...</div>;
  }

  const items = NAV_ITEMS.filter((item) => item.show(user.role));

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — desktop */}
      <aside className="hidden w-60 flex-col border-r border-gray-200 bg-white p-4 md:flex">
        <SidebarContent items={items} pathname={pathname} user={user} onLogout={logout} />
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="flex w-full flex-col md:hidden">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white p-3">
          <span className="text-base font-semibold">MedRota Cloud</span>
          <button
            onClick={() => setMenuOpen(true)}
            className="rounded-md border border-gray-300 px-3 py-1 text-sm"
            aria-label="เปิดเมนู"
          >
            เมนู
          </button>
        </header>
        {menuOpen && (
          <div className="fixed inset-0 z-40 flex bg-black/40" onClick={() => setMenuOpen(false)}>
            <div className="flex h-full w-64 flex-col bg-white p-4" onClick={(e) => e.stopPropagation()}>
              <SidebarContent
                items={items}
                pathname={pathname}
                user={user}
                onLogout={logout}
                onNavigate={() => setMenuOpen(false)}
              />
            </div>
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </div>

      <main className="hidden flex-1 p-6 md:block">{children}</main>
    </div>
  );
}

function SidebarContent({
  items,
  pathname,
  user,
  onLogout,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  user: { fullName: string; role: Role };
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="mb-6">
        <p className="text-base font-semibold">MedRota Cloud</p>
        <p className="text-xs text-gray-400">บริหารจัดการเวรโรงพยาบาล</p>
      </div>
      <nav className="flex-1 space-y-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${
                active ? 'bg-shift-night text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-6 border-t border-gray-200 pt-4">
        <p className="truncate text-sm font-medium">{user.fullName}</p>
        <p className="text-xs text-gray-400">{ROLE_LABELS[user.role]}</p>
        <div className="mt-3 flex flex-col gap-1">
          <Link href="/change-password" onClick={onNavigate} className="text-sm text-gray-500 hover:text-gray-800">
            เปลี่ยนรหัสผ่าน
          </Link>
          <button onClick={onLogout} className="text-left text-sm text-risk-critical hover:opacity-80">
            ออกจากระบบ
          </button>
        </div>
      </div>
    </>
  );
}
