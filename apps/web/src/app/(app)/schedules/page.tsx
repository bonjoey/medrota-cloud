'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { canEditSchedule } from '@/lib/roles';
import { ApiError, schedulesApi, wardsApi, type Schedule, type ScheduleStatus, type Ward } from '@/lib/api-client';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Spinner, inputClass } from '@/components/ui';

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  DRAFT: 'ร่าง',
  REVIEW: 'รอตรวจทาน',
  APPROVED: 'อนุมัติแล้ว',
  PUBLISHED: 'ประกาศใช้แล้ว',
};
const STATUS_COLORS: Record<ScheduleStatus, string> = {
  DRAFT: '#9CA3AF',
  REVIEW: '#F59E0B',
  APPROVED: '#3B82F6',
  PUBLISHED: '#16A34A',
};
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** FR-A08: รายการตารางเวรรายเดือนต่อหอผู้ป่วย — จุดเริ่มสร้างตารางใหม่ */
export default function SchedulesPage() {
  const { user } = useAuth();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [newWardId, setNewWardId] = useState('');
  const now = useMemo(() => new Date(), []);
  const [newMonth, setNewMonth] = useState(now.getMonth() + 1);
  const [newYear, setNewYear] = useState(now.getFullYear());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, w] = await Promise.all([schedulesApi.list(), wardsApi.list()]);
      setSchedules(s);
      setWards(w);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!user) return null;
  const canCreate = canEditSchedule(user.role);
  const currentRole = user.role;
  const currentWardId = user.wardId;

  function openCreate() {
    setNewWardId(currentRole === 'HEAD_NURSE' ? currentWardId ?? '' : '');
    setFormError(null);
    setModalOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const schedule = await schedulesApi.create({ wardId: newWardId, month: newMonth, year: newYear });
      window.location.href = `/schedules/${schedule.id}`;
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'สร้างตารางเวรไม่สำเร็จ');
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="ตารางเวร"
        description="ตารางเวรประจำเดือนแยกตามหอผู้ป่วย (FR-A08)"
        actions={canCreate ? <Button onClick={openCreate}>+ สร้างตารางเวรใหม่</Button> : undefined}
      />

      {error && <Alert kind="error">{error}</Alert>}

      <Card className="mt-4 p-0 overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : schedules.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">ยังไม่มีตารางเวร</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="px-4 py-3">หอผู้ป่วย</th>
                <th className="px-4 py-3">เดือน/ปี</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">{s.ward?.name ?? wards.find((w) => w.id === s.wardId)?.name}</td>
                  <td className="px-4 py-3">
                    {THAI_MONTHS[s.month - 1]} {s.year}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={STATUS_COLORS[s.status]}>{STATUS_LABELS[s.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/schedules/${s.id}`} className="text-shift-afternoon hover:underline">
                      เปิดตาราง →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {modalOpen && (
        <Modal title="สร้างตารางเวรใหม่" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            <Field label="หอผู้ป่วย">
              <select
                required
                disabled={user.role === 'HEAD_NURSE'}
                className={inputClass}
                value={newWardId}
                onChange={(e) => setNewWardId(e.target.value)}
              >
                <option value="">— เลือกหอผู้ป่วย —</option>
                {wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="เดือน">
                <select className={inputClass} value={newMonth} onChange={(e) => setNewMonth(Number(e.target.value))}>
                  {THAI_MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ปี พ.ศ./ค.ศ.">
                <input
                  type="number"
                  required
                  className={inputClass}
                  value={newYear}
                  onChange={(e) => setNewYear(Number(e.target.value))}
                />
              </Field>
            </div>

            {formError && <Alert kind="error">{formError}</Alert>}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'กำลังสร้าง...' : 'สร้างตาราง'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
