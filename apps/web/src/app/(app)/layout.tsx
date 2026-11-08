'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABELS, canManageHospitalSettings, canManageOrgStructure, canViewUsers } from '@/lib/roles';
import { notificationsApi, type NotificationRecord, type Role } from '@/lib/api-client';

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
  { href: '/leaves', label: 'คำขอลา', show: () => true },
  { href: '/shift-swaps', label: 'แลกเวร', show: () => true },
  { href: '/reports', label: 'รายงาน', show: canViewUsers },
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
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button
              onClick={() => setMenuOpen(true)}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm"
              aria-label="เปิดเมนู"
            >
              เมนู
            </button>
          </div>
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
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-base font-semibold">MedRota Cloud</p>
          <p className="text-xs text-gray-400">บริหารจัดการเวรโรงพยาบาล</p>
        </div>
        <NotificationBell />
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

const TIME_LABEL = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** FR-U08 (MVP 3 Sprint 11): Notification Center — poll unread count ทุก 30 วิ,
 * เปิด panel แล้วโหลดรายการล่าสุด 50 รายการ, คลิกแต่ละอันเพื่อ mark read */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    function poll() {
      notificationsApi
        .unreadCount()
        .then((count) => mounted && setUnreadCount(count))
        .catch(() => undefined);
    }
    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      notificationsApi
        .list()
        .then(setItems)
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }
  }

  async function handleItemClick(n: NotificationRecord) {
    if (!n.isRead) {
      await notificationsApi.markRead(n.id).catch(() => undefined);
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) ?? prev);
      setUnreadCount((c) => Math.max(0, c - 1));
    }
  }

  async function handleMarkAll() {
    await notificationsApi.markAllRead().catch(() => undefined);
    setItems((prev) => prev?.map((x) => ({ ...x, isRead: true })) ?? prev);
    setUnreadCount(0);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggle}
        className="relative rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
        aria-label="การแจ้งเตือน"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M12 2a6 6 0 0 0-6 6v3.09c0 .7-.26 1.37-.74 1.89L4 14.5c-.76.82-.18 2.15.93 2.15h14.14c1.11 0 1.69-1.33.93-2.15l-1.26-1.52a2.6 2.6 0 0 1-.74-1.89V8a6 6 0 0 0-6-6ZM9.5 19a2.5 2.5 0 0 0 5 0h-5Z" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-risk-critical px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-sm font-medium">การแจ้งเตือน</p>
            <button onClick={handleMarkAll} className="text-xs text-shift-night hover:underline">
              อ่านทั้งหมด
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-center text-sm text-gray-400">กำลังโหลด...</p>
            ) : !items || items.length === 0 ? (
              <p className="p-4 text-center text-sm text-gray-400">ไม่มีการแจ้งเตือน</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  className={`block w-full border-b border-gray-50 px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                    n.isRead ? 'text-gray-500' : 'bg-blue-50/50 font-medium text-gray-800'
                  }`}
                >
                  <p>{n.title}</p>
                  <p className="mt-0.5 text-xs font-normal text-gray-400">{n.body}</p>
                  <p className="mt-0.5 text-[11px] font-normal text-gray-300">{TIME_LABEL(n.createdAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
