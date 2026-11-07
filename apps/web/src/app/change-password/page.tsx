'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, usersApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Alert } from '@/components/ui';

/** NFR-02: นโยบายรหัสผ่าน — อย่างน้อย 8 ตัว ต้องมีทั้งตัวอักษรและตัวเลข */
function PasswordPolicyHint() {
  return <p className="text-xs text-gray-400">อย่างน้อย 8 ตัวอักษร ต้องมีทั้งตัวอักษรและตัวเลข</p>;
}

function ChangePasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const forced = params.get('forced') === '1';
  const { user, loading: authLoading, logout } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setSubmitting(true);
    try {
      await usersApi.changeOwnPassword(currentPassword, newPassword);
      if (user) {
        localStorage.setItem('currentUser', JSON.stringify({ ...user, mustChangePassword: false }));
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || !user) return null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">เปลี่ยนรหัสผ่าน</h1>
        {forced ? (
          <Alert kind="info">บัญชีนี้ต้องเปลี่ยนรหัสผ่านก่อนใช้งานต่อ (บัญชีใหม่ / ถูกรีเซ็ตโดยผู้ดูแล)</Alert>
        ) : (
          <p className="text-sm text-gray-500">สำหรับ {user.fullName}</p>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium">รหัสผ่านปัจจุบัน</label>
          <input
            type="password"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">รหัสผ่านใหม่</label>
          <input
            type="password"
            required
            minLength={8}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <PasswordPolicyHint />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">ยืนยันรหัสผ่านใหม่</label>
          <input
            type="password"
            required
            minLength={8}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-shift-night px-3 py-2 text-base font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
        </button>

        {!forced && (
          <button type="button" onClick={() => router.push('/dashboard')} className="w-full text-sm text-gray-400">
            ยกเลิก
          </button>
        )}
        {forced && (
          <button type="button" onClick={() => logout()} className="w-full text-sm text-gray-400">
            ออกจากระบบ
          </button>
        )}
      </form>
    </main>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={null}>
      <ChangePasswordInner />
    </Suspense>
  );
}
