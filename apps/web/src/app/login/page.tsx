'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

/**
 * FR-A01, NFR-02: หน้า Login — Username/Password
 * INT-03/04/05 (SSO Google/Microsoft/Facebook) เป็นงาน MVP 3 Sprint 11 — ยังไม่ทำใน Sprint 0
 */
export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [employeeCodeOrEmail, setEmployeeCodeOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(employeeCodeOrEmail, password);
      // NFR-02: บังคับเปลี่ยนรหัสผ่านก่อนใช้งานต่อ ถ้าบัญชีถูกสร้างใหม่หรือถูกรีเซ็ต
      router.push(res.mustChangePassword ? '/change-password?forced=1' : '/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold">MedRota Cloud</h1>
        <p className="text-sm text-gray-500">บริหารจัดการเวรโรงพยาบาล</p>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="employeeCodeOrEmail">
            รหัสประจำตัว / อีเมล
          </label>
          <input
            id="employeeCodeOrEmail"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            value={employeeCodeOrEmail}
            onChange={(e) => setEmployeeCodeOrEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="password">
            รหัสผ่าน
          </label>
          <input
            id="password"
            type="password"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-base"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>

        {error && <p className="text-sm text-risk-critical">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-shift-night px-3 py-2 text-base font-medium text-white disabled:opacity-50"
        >
          {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </main>
  );
}
