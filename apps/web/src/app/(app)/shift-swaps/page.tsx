'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canApproveSwap } from '@/lib/roles';
import {
  ApiError,
  nursePortalApi,
  shiftSwapsApi,
  type DepartmentScheduleResponse,
  type MyScheduleResponse,
  type ShiftSwapRequestRecord,
} from '@/lib/api-client';
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Spinner, inputClass } from '@/components/ui';

const STATUS_LABELS: Record<string, string> = {
  PENDING_COUNTERPARTY: 'รอคู่สลับตอบรับ',
  PENDING_ADMIN_APPROVAL: 'รอ Admin อนุมัติ',
  APPROVED: 'แลกเวรสำเร็จ',
  REJECTED: 'ถูกปฏิเสธ',
  CANCELLED: 'ยกเลิกแล้ว',
  EXPIRED: 'หมดอายุ',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING_COUNTERPARTY: '#D97706',
  PENDING_ADMIN_APPROVAL: '#2563EB',
  APPROVED: '#059669',
  REJECTED: '#DC2626',
  CANCELLED: '#6B7280',
  EXPIRED: '#6B7280',
};

/** FR-U03/FR-A12/BP-02 (MVP 3 Sprint 9): แลกเวรระหว่างบุคลากร 2 คน */
export default function ShiftSwapsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ShiftSwapRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ swap: ShiftSwapRequestRecord; mode: 'counterparty' | 'admin' } | null>(
    null,
  );

  const canApprove = user ? canApproveSwap(user.role) : false;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(await shiftSwapsApi.list());
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

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  }

  const needsMyResponse = items.filter((s) => s.status === 'PENDING_COUNTERPARTY' && s.counterpartyId === user?.id);
  const pendingAdmin = canApprove ? items.filter((s) => s.status === 'PENDING_ADMIN_APPROVAL') : [];
  const myOngoing = items.filter(
    (s) =>
      (s.requesterId === user?.id || s.counterpartyId === user?.id) &&
      !needsMyResponse.includes(s) &&
      !pendingAdmin.includes(s),
  );

  return (
    <div>
      <PageHeader
        title="แลกเวร"
        description="เสนอแลกเวรกับเพื่อนร่วมงาน (FR-U03) — ต้องได้รับการตอบรับและอนุมัติจาก Admin ก่อนมีผลจริง (FR-A12)"
        actions={<Button onClick={() => setShowForm(true)}>เสนอแลกเวรใหม่</Button>}
      />

      {error && <Alert kind="error">{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          {needsMyResponse.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-600">รอคุณตอบรับ ({needsMyResponse.length})</h2>
              <div className="space-y-3">
                {needsMyResponse.map((s) => (
                  <SwapCard
                    key={s.id}
                    swap={s}
                    busy={busyId === s.id}
                    actions={
                      <>
                        <Button
                          variant="primary"
                          disabled={busyId === s.id}
                          onClick={() => run(s.id, () => shiftSwapsApi.counterpartyDecision(s.id, true))}
                        >
                          ตอบรับ
                        </Button>
                        <Button
                          variant="danger"
                          disabled={busyId === s.id}
                          onClick={() => setRejectTarget({ swap: s, mode: 'counterparty' })}
                        >
                          ปฏิเสธ
                        </Button>
                      </>
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {canApprove && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-600">รอ Admin อนุมัติ ({pendingAdmin.length})</h2>
              {pendingAdmin.length === 0 ? (
                <EmptyState label="ไม่มีคำขอแลกเวรรออนุมัติ" />
              ) : (
                <div className="space-y-3">
                  {pendingAdmin.map((s) => (
                    <SwapCard
                      key={s.id}
                      swap={s}
                      busy={busyId === s.id}
                      actions={
                        <>
                          <Button
                            variant="primary"
                            disabled={busyId === s.id}
                            onClick={() => run(s.id, () => shiftSwapsApi.adminDecision(s.id, true))}
                          >
                            อนุมัติ
                          </Button>
                          <Button
                            variant="danger"
                            disabled={busyId === s.id}
                            onClick={() => setRejectTarget({ swap: s, mode: 'admin' })}
                          >
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
            <h2 className="mb-2 text-sm font-semibold text-gray-600">คำขอแลกเวรของฉัน</h2>
            {myOngoing.length === 0 ? (
              <EmptyState label="ไม่มีคำขอแลกเวร" />
            ) : (
              <div className="space-y-3">
                {myOngoing.map((s) => (
                  <SwapCard
                    key={s.id}
                    swap={s}
                    busy={busyId === s.id}
                    actions={
                      s.requesterId === user?.id &&
                      (s.status === 'PENDING_COUNTERPARTY' || s.status === 'PENDING_ADMIN_APPROVAL') ? (
                        <Button variant="ghost" disabled={busyId === s.id} onClick={() => run(s.id, () => shiftSwapsApi.cancel(s.id))}>
                          ยกเลิกคำขอ
                        </Button>
                      ) : null
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {showForm && (
        <CreateSwapModal
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {rejectTarget && (
        <RejectSwapModal
          target={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onDone={() => {
            setRejectTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function SwapCard({
  swap,
  busy,
  actions,
}: {
  swap: ShiftSwapRequestRecord;
  busy: boolean;
  actions?: React.ReactNode;
}) {
  const violations = swap.constraintCheckResult?.violations ?? [];
  return (
    <Card className={busy ? 'opacity-60' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {swap.requester.fullName} ↔ {swap.counterparty.fullName}
          </p>
          {violations.length > 0 && (
            <p className="mt-1 text-xs text-risk-critical">
              ⚠ ตรวจพบความขัดแย้งกับกฎระเบียบ {violations.length} รายการ: {violations[0].message}
            </p>
          )}
          {swap.status === 'REJECTED' && swap.rejectionReason && (
            <p className="mt-1 text-xs text-gray-400">เหตุผลที่ปฏิเสธ: {swap.rejectionReason}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge color={STATUS_COLORS[swap.status]}>{STATUS_LABELS[swap.status]}</Badge>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      </div>
    </Card>
  );
}

function CreateSwapModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const now = useMemo(() => new Date(), []);
  const [month] = useState(now.getMonth() + 1);
  const [year] = useState(now.getFullYear());
  const [mySchedule, setMySchedule] = useState<MyScheduleResponse | null>(null);
  const [deptSchedule, setDeptSchedule] = useState<DepartmentScheduleResponse | null>(null);
  const [requesterAssignmentId, setRequesterAssignmentId] = useState('');
  const [counterpartyAssignmentId, setCounterpartyAssignmentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    Promise.all([nursePortalApi.mySchedule(month, year), nursePortalApi.departmentSchedule(month, year)])
      .then(([mine, dept]) => {
        setMySchedule(mine);
        setDeptSchedule(dept);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดตารางเวรไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [month, year]);

  const counterpartyOptions = (deptSchedule?.assignments ?? []).filter((a) => a.userId !== user?.id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!requesterAssignmentId || !counterpartyAssignmentId) {
      setError('กรุณาเลือกเวรทั้งสองฝ่าย');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await shiftSwapsApi.create({ requesterAssignmentId, counterpartyAssignmentId });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เสนอแลกเวรไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="เสนอแลกเวรใหม่" onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="เวรของฉันที่ต้องการให้คนอื่นแลก">
            <select className={inputClass} value={requesterAssignmentId} onChange={(e) => setRequesterAssignmentId(e.target.value)}>
              <option value="">เลือกเวร...</option>
              {(mySchedule?.assignments ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.date.slice(0, 10)} · {a.shiftType.code} {a.shiftType.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="เวรของคนที่ต้องการแลกด้วย">
            <select className={inputClass} value={counterpartyAssignmentId} onChange={(e) => setCounterpartyAssignmentId(e.target.value)}>
              <option value="">เลือกเวร...</option>
              {counterpartyOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.date.slice(0, 10)} · {a.shiftType.code} · {a.user.fullName}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-gray-400">แสดงเฉพาะเวรในตารางเวรหน่วยงานของเดือนปัจจุบัน ({month}/{year})</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} type="button">
              ยกเลิก
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'กำลังส่ง...' : 'เสนอแลกเวร'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RejectSwapModal({
  target,
  onClose,
  onDone,
}: {
  target: { swap: ShiftSwapRequestRecord; mode: 'counterparty' | 'admin' };
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (target.mode === 'counterparty') {
        await shiftSwapsApi.counterpartyDecision(target.swap.id, false, reason);
      } else {
        await shiftSwapsApi.adminDecision(target.swap.id, false, reason);
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ปฏิเสธไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="ปฏิเสธคำขอแลกเวร" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="เหตุผล (ไม่บังคับ)">
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
