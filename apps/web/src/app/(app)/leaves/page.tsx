'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canApproveLeave } from '@/lib/roles';
import { ApiError, leavesApi, type LeaveRequestRecord, type LeaveType } from '@/lib/api-client';
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Spinner, inputClass } from '@/components/ui';

const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  SICK: 'ลาป่วย',
  VACATION: 'ลาพักผ่อน',
  PERSONAL: 'ลากิจ',
  EMERGENCY: 'ลาฉุกเฉิน',
  OTHER: 'อื่น ๆ',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#D97706',
  APPROVED: '#059669',
  REJECTED: '#DC2626',
  CANCELLED: '#6B7280',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอการอนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ถูกปฏิเสธ',
  CANCELLED: 'ยกเลิกแล้ว',
};

/** FR-U04/FR-A13/BP-03 (MVP 3 Sprint 9): คำขอลา — พยาบาลยื่น/ดูของตนเอง, Admin อนุมัติ/ปฏิเสธ */
export default function LeavesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<LeaveRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequestRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canApprove = user ? canApproveLeave(user.role) : false;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(await leavesApi.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCancel(id: string) {
    setBusyId(id);
    try {
      await leavesApi.cancel(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ยกเลิกไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  }

  async function handleApprove(id: string) {
    setBusyId(id);
    try {
      await leavesApi.approve(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'อนุมัติไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  }

  const own = items.filter((l) => l.userId === user?.id);
  const pendingApprovals = canApprove ? items.filter((l) => l.status === 'PENDING' && l.userId !== user?.id) : [];
  const otherHistory = canApprove ? items.filter((l) => l.status !== 'PENDING' && l.userId !== user?.id) : [];

  return (
    <div>
      <PageHeader
        title="คำขอลา"
        description="ยื่นคำขอลาและติดตามสถานะ (FR-U04) — หัวหน้าตึก/ผู้ดูแลระบบอนุมัติที่นี่ (FR-A13)"
        actions={<Button onClick={() => setShowForm(true)}>ยื่นคำขอลาใหม่</Button>}
      />

      {error && <Alert kind="error">{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          {canApprove && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-600">รออนุมัติ ({pendingApprovals.length})</h2>
              {pendingApprovals.length === 0 ? (
                <EmptyState label="ไม่มีคำขอลารออนุมัติ" />
              ) : (
                <div className="space-y-3">
                  {pendingApprovals.map((l) => (
                    <LeaveCard
                      key={l.id}
                      leave={l}
                      busy={busyId === l.id}
                      actions={
                        <>
                          <Button variant="primary" onClick={() => handleApprove(l.id)} disabled={busyId === l.id}>
                            อนุมัติ
                          </Button>
                          <Button variant="danger" onClick={() => setRejectTarget(l)} disabled={busyId === l.id}>
                            ปฏิเสธ
                          </Button>
                        </>
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-600">คำขอลาของฉัน ({own.length})</h2>
            {own.length === 0 ? (
              <EmptyState label="ยังไม่มีคำขอลา" />
            ) : (
              <div className="space-y-3">
                {own.map((l) => (
                  <LeaveCard
                    key={l.id}
                    leave={l}
                    busy={busyId === l.id}
                    actions={
                      l.status === 'PENDING' ? (
                        <Button variant="ghost" onClick={() => handleCancel(l.id)} disabled={busyId === l.id}>
                          ยกเลิกคำขอ
                        </Button>
                      ) : null
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {canApprove && otherHistory.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-600">ประวัติคำขอลาอื่น ๆ</h2>
              <div className="space-y-3">
                {otherHistory.map((l) => (
                  <LeaveCard key={l.id} leave={l} busy={false} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {showForm && (
        <CreateLeaveModal
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {rejectTarget && (
        <RejectLeaveModal
          leave={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={() => {
            setRejectTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function LeaveCard({
  leave,
  busy,
  actions,
}: {
  leave: LeaveRequestRecord;
  busy: boolean;
  actions?: React.ReactNode;
}) {
  const understaffed = leave.impactAssessment?.understaffedShifts ?? [];
  return (
    <Card className={busy ? 'opacity-60' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {leave.user.fullName} · {LEAVE_TYPE_LABELS[leave.leaveType]}
            {leave.isEmergency && (
              <span className="ml-2">
                <Badge color="#DC2626">ฉุกเฉิน</Badge>
              </span>
            )}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {leave.startDate.slice(0, 10)} – {leave.endDate.slice(0, 10)}
          </p>
          <p className="mt-1 text-sm text-gray-700">{leave.reason}</p>
          {understaffed.length > 0 && (
            <p className="mt-2 text-xs text-risk-critical">
              ⚠ อาจทำให้ขาดคนขั้นต่ำ {understaffed.length} เวร (เช่น {understaffed[0].date} {understaffed[0].shiftTypeCode}:
              เหลือ {understaffed[0].currentCount}/{understaffed[0].minimumRequired})
            </p>
          )}
          {leave.status === 'REJECTED' && leave.rejectionReason && (
            <p className="mt-1 text-xs text-gray-400">เหตุผลที่ปฏิเสธ: {leave.rejectionReason}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge color={STATUS_COLORS[leave.status]}>{STATUS_LABELS[leave.status]}</Badge>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      </div>
    </Card>
  );
}

function CreateLeaveModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [leaveType, setLeaveType] = useState<LeaveType>('VACATION');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isEmergency, setIsEmergency] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate || !reason.trim()) {
      setError('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await leavesApi.create({ leaveType, startDate, endDate, reason, isEmergency });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ยื่นคำขอลาไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="ยื่นคำขอลาใหม่" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="ประเภทการลา">
          <select className={inputClass} value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)}>
            {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="วันที่เริ่มลา">
            <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="วันที่สิ้นสุด">
            <input type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Field label="เหตุผล">
          <textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={isEmergency} onChange={(e) => setIsEmergency(e.target.checked)} />
          เป็นการลาฉุกเฉิน (เส้นทางเร่งด่วน — ข้ามตรวจสิทธิวันลาคงเหลือ และจัดเวรทดแทนอัตโนมัติทันทีที่อนุมัติ)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} type="button">
            ยกเลิก
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'กำลังส่ง...' : 'ยื่นคำขอ'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RejectLeaveModal({
  leave,
  onClose,
  onRejected,
}: {
  leave: LeaveRequestRecord;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('กรุณาระบุเหตุผลที่ปฏิเสธ');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await leavesApi.reject(leave.id, reason);
      onRejected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ปฏิเสธคำขอไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`ปฏิเสธคำขอลาของ ${leave.user.fullName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="เหตุผลที่ปฏิเสธ">
          <textarea className={inputClass} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} type="button">
            ยกเลิก
          </Button>
          <Button variant="danger" type="submit" disabled={saving}>
            {saving ? 'กำลังส่ง...' : 'ยืนยันปฏิเสธ'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
