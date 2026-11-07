'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { canApproveSchedule, canEditSchedule, canExportSchedule } from '@/lib/roles';
import {
  ApiError,
  downloadScheduleExport,
  schedulesApi,
  shiftTypesApi,
  usersApi,
  type ConflictCheckResult,
  type ScheduleAssignment,
  type ScheduleChangeLog,
  type ScheduleDetail,
  type ScheduleStatus,
  type ShiftType,
  type UserRecord,
} from '@/lib/api-client';
import { Alert, Badge, Button, Card, Spinner } from '@/components/ui';

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
const SHIFT_COLORS: Record<string, string> = { M: '#F59E0B', A: '#3B82F6', N: '#4C1D95' };
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/**
 * FR-A08: Grid ตารางเวร (Drag & Drop) | FR-A09: แก้ไข + Change Log | FR-A10: ตรวจความขัดแย้ง
 * FR-A11: Workflow Draft→Review→Approved→Published | FR-R01: Export PDF/Excel
 */
export default function ScheduleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [schedule, setSchedule] = useState<ScheduleDetail | null>(null);
  const [staff, setStaff] = useState<UserRecord[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [conflictResult, setConflictResult] = useState<ConflictCheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  const [changeLogs, setChangeLogs] = useState<ScheduleChangeLog[] | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, u, st] = await Promise.all([schedulesApi.get(id), usersApi.list(), shiftTypesApi.list()]);
      setSchedule(s);
      setStaff(u.filter((x) => x.primaryWardId === s.wardId && x.status === 'ACTIVE'));
      setShiftTypes(st);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const daysInMonth = useMemo(() => {
    if (!schedule) return 0;
    return new Date(schedule.year, schedule.month, 0).getDate();
  }, [schedule]);

  const dateStrings = useMemo(() => {
    if (!schedule) return [];
    return Array.from({ length: daysInMonth }, (_, i) => `${schedule.year}-${pad2(schedule.month)}-${pad2(i + 1)}`);
  }, [schedule, daysInMonth]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, ScheduleAssignment>();
    schedule?.assignments.forEach((a) => {
      const dateStr = a.date.slice(0, 10);
      map.set(`${a.userId}_${dateStr}`, a);
    });
    return map;
  }, [schedule]);

  const violationKeys = useMemo(() => {
    const set = new Set<string>();
    conflictResult?.violations.forEach((v) =>
      v.locations.forEach((loc) => set.add(`${loc.user_id}_${loc.date.slice(0, 10)}`)),
    );
    return set;
  }, [conflictResult]);

  if (!user) return null;
  if (loading) return <Spinner />;
  if (error || !schedule) return <Alert kind="error">{error ?? 'ไม่พบตารางเวร'}</Alert>;

  const editable = schedule.status !== 'PUBLISHED' && canEditSchedule(user.role);
  const canApprove = canApproveSchedule(user.role);

  async function handleDrop(userId: string, dateStr: string, shiftTypeId: string) {
    setActionError(null);
    try {
      const updated = await schedulesApi.upsertAssignment(schedule!.id, { userId, shiftTypeId, date: dateStr });
      setSchedule((prev) => {
        if (!prev) return prev;
        const next = prev.assignments.filter((a) => a.id !== updated.id);
        next.push(updated);
        return { ...prev, assignments: next };
      });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'กำหนดเวรไม่สำเร็จ');
    }
  }

  async function handleRemove(assignmentId: string) {
    setActionError(null);
    try {
      await schedulesApi.removeAssignment(schedule!.id, assignmentId);
      setSchedule((prev) => (prev ? { ...prev, assignments: prev.assignments.filter((a) => a.id !== assignmentId) } : prev));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'ลบเวรไม่สำเร็จ');
    }
  }

  async function handleCheckConflicts() {
    setChecking(true);
    setActionError(null);
    try {
      const result = await schedulesApi.checkConflicts(schedule!.id);
      setConflictResult(result);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'ตรวจสอบความขัดแย้งไม่สำเร็จ');
    } finally {
      setChecking(false);
    }
  }

  async function toggleChangeLogs() {
    if (!logsOpen && changeLogs === null) {
      try {
        setChangeLogs(await schedulesApi.changeLogs(schedule!.id));
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'โหลดประวัติการแก้ไขไม่สำเร็จ');
      }
    }
    setLogsOpen((v) => !v);
  }

  async function runWorkflow(action: 'submit' | 'approve' | 'publish' | 'sendBack') {
    setActionBusy(true);
    setActionError(null);
    try {
      if (action === 'submit') await schedulesApi.submitForReview(schedule!.id);
      else if (action === 'approve') await schedulesApi.approve(schedule!.id);
      else if (action === 'publish') await schedulesApi.publish(schedule!.id);
      else if (action === 'sendBack') {
        const reason = window.prompt('ระบุเหตุผลที่ตีกลับตารางเวรนี้:');
        if (!reason) {
          setActionBusy(false);
          return;
        }
        await schedulesApi.sendBack(schedule!.id, reason);
      }
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        const violations = (err.details as { violations?: { message: string }[] } | undefined)?.violations;
        setActionError(violations?.length ? `${err.message}: ${violations.map((v) => v.message).join('; ')}` : err.message);
      } else {
        setActionError('ดำเนินการไม่สำเร็จ');
      }
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <button onClick={() => router.push('/schedules')} className="text-sm text-gray-400 hover:text-gray-700">
            ← กลับไปรายการตารางเวร
          </button>
          <h1 className="mt-1 text-xl font-semibold">
            {schedule.ward?.name} — {THAI_MONTHS[schedule.month - 1]} {schedule.year}
          </h1>
        </div>
        <Badge color={STATUS_COLORS[schedule.status]}>{STATUS_LABELS[schedule.status]}</Badge>
      </div>

      {actionError && <Alert kind="error">{actionError}</Alert>}

      {/* FR-A11: ปุ่ม Workflow */}
      <Card className="mb-4 flex flex-wrap items-center gap-2">
        {schedule.status === 'DRAFT' && canEditSchedule(user.role) && (
          <Button onClick={() => runWorkflow('submit')} disabled={actionBusy}>
            ส่งตรวจทาน
          </Button>
        )}
        {schedule.status === 'REVIEW' && canApprove && (
          <>
            <Button onClick={() => runWorkflow('approve')} disabled={actionBusy}>
              อนุมัติ
            </Button>
            <Button variant="secondary" onClick={() => runWorkflow('sendBack')} disabled={actionBusy}>
              ตีกลับไปแก้ไข
            </Button>
          </>
        )}
        {schedule.status === 'APPROVED' && canApprove && (
          <>
            <Button onClick={() => runWorkflow('publish')} disabled={actionBusy}>
              ประกาศใช้ตารางเวร
            </Button>
            <Button variant="secondary" onClick={() => runWorkflow('sendBack')} disabled={actionBusy}>
              ตีกลับไปแก้ไข
            </Button>
          </>
        )}
        <Button variant="secondary" onClick={handleCheckConflicts} disabled={checking}>
          {checking ? 'กำลังตรวจสอบ...' : 'ตรวจสอบความขัดแย้ง (FR-A10)'}
        </Button>
        <Button variant="ghost" onClick={toggleChangeLogs}>
          {logsOpen ? 'ซ่อนประวัติการแก้ไข' : 'ดูประวัติการแก้ไข'}
        </Button>
        {canExportSchedule(user.role) && (
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => downloadScheduleExport(schedule.id, 'pdf')}>
              ส่งออก PDF
            </Button>
            <Button variant="secondary" onClick={() => downloadScheduleExport(schedule.id, 'xlsx')}>
              ส่งออก Excel
            </Button>
          </div>
        )}
      </Card>

      {/* FR-A10: ผลตรวจความขัดแย้ง */}
      {conflictResult && (
        <Alert kind={conflictResult.is_valid ? 'success' : 'error'}>
          {conflictResult.is_valid ? (
            'ไม่พบความขัดแย้งกับกฎระเบียบ Hard Constraint ใด ๆ'
          ) : (
            <div>
              <p className="font-medium">พบความขัดแย้ง {conflictResult.violations.length} รายการ:</p>
              <ul className="mt-1 list-disc pl-5">
                {conflictResult.violations.map((v, i) => (
                  <li key={i}>{v.message}</li>
                ))}
              </ul>
            </div>
          )}
        </Alert>
      )}

      {/* FR-A09: ประวัติการแก้ไข */}
      {logsOpen && (
        <Card className="mb-4">
          <h2 className="mb-2 font-medium">ประวัติการแก้ไข</h2>
          {changeLogs === null ? (
            <Spinner />
          ) : changeLogs.length === 0 ? (
            <p className="text-sm text-gray-400">ยังไม่มีประวัติการแก้ไข</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {changeLogs.map((log) => (
                <li key={log.id} className="border-b border-gray-100 pb-2">
                  <span className="text-gray-400">{new Date(log.createdAt).toLocaleString('th-TH')}</span> —{' '}
                  <span className="font-medium">{log.changeType}</span>
                  {log.reason && <span className="text-gray-500"> ({log.reason})</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Palette ประเภทเวรสำหรับลากไปวางในตาราง */}
      {editable && (
        <Card className="mb-4">
          <p className="mb-2 text-sm text-gray-500">ลากประเภทเวรไปวางบนช่องในตาราง เพื่อกำหนดเวร (คลิกช่องที่มีเวรอยู่แล้วเพื่อลบ)</p>
          <div className="flex flex-wrap gap-2">
            {shiftTypes.map((s) => (
              <div
                key={s.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('shiftTypeId', s.id)}
                className="cursor-grab select-none rounded-md px-3 py-1 text-sm font-medium text-white active:cursor-grabbing"
                style={{ backgroundColor: SHIFT_COLORS[s.code] ?? '#059669' }}
                title={`${s.name} (${s.startTime}-${s.endTime})`}
              >
                {s.code}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Grid ตารางเวร */}
      <Card className="overflow-x-auto p-0">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[160px] border-b border-r border-gray-200 bg-white px-3 py-2 text-left">
                บุคลากร
              </th>
              {dateStrings.map((d, i) => {
                const weekday = new Date(schedule.year, schedule.month - 1, i + 1).getDay();
                return (
                  <th
                    key={d}
                    className={`min-w-[44px] border-b border-gray-200 px-1 py-2 text-center font-normal ${
                      weekday === 0 || weekday === 6 ? 'bg-gray-50' : ''
                    }`}
                  >
                    <div>{i + 1}</div>
                    <div className="text-xs text-gray-400">{THAI_WEEKDAYS[weekday]}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && (
              <tr>
                <td colSpan={daysInMonth + 1} className="px-4 py-6 text-center text-sm text-gray-400">
                  ไม่มีบุคลากรประจำหอผู้ป่วยนี้
                </td>
              </tr>
            )}
            {staff.map((person) => (
              <tr key={person.id}>
                <td className="sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-3 py-2">
                  <div className="font-medium">{person.fullName}</div>
                  <div className="text-xs text-gray-400">{person.employeeCode}</div>
                </td>
                {dateStrings.map((d) => {
                  const assignment = assignmentMap.get(`${person.id}_${d}`);
                  const hasViolation = violationKeys.has(`${person.id}_${d}`);
                  return (
                    <td
                      key={d}
                      onDragOver={(e) => editable && e.preventDefault()}
                      onDrop={(e) => {
                        if (!editable) return;
                        e.preventDefault();
                        const shiftTypeId = e.dataTransfer.getData('shiftTypeId');
                        if (shiftTypeId) handleDrop(person.id, d, shiftTypeId);
                      }}
                      onClick={() => {
                        if (editable && assignment) handleRemove(assignment.id);
                      }}
                      className={`border-b border-gray-100 p-1 text-center ${editable ? 'cursor-pointer' : ''} ${
                        hasViolation ? 'bg-red-50 ring-1 ring-inset ring-risk-critical' : ''
                      }`}
                      title={assignment ? `${assignment.shiftType.name}${editable ? ' (คลิกเพื่อลบ)' : ''}` : undefined}
                    >
                      {assignment && (
                        <span
                          className="inline-block w-8 rounded text-xs font-medium text-white"
                          style={{ backgroundColor: SHIFT_COLORS[assignment.shiftType.code] ?? '#059669' }}
                        >
                          {assignment.shiftType.code}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* FR-A08: สรุปจำนวนเวร/ชั่วโมงต่อบุคคล */}
      <Card className="mt-4 overflow-x-auto p-0">
        <h2 className="px-4 pt-4 font-medium">สรุปรายบุคคล</h2>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th className="px-4 py-2">บุคลากร</th>
              <th className="px-4 py-2">จำนวนเวร</th>
              <th className="px-4 py-2">ชั่วโมงรวม</th>
              {shiftTypes.map((s) => (
                <th key={s.id} className="px-4 py-2">
                  {s.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schedule.summary.map((row) => (
              <tr key={row.userId} className="border-b border-gray-100">
                <td className="px-4 py-2">
                  {row.fullName} <span className="text-xs text-gray-400">({row.employeeCode})</span>
                </td>
                <td className="px-4 py-2">{row.totalShifts}</td>
                <td className="px-4 py-2">{row.totalHours.toFixed(1)}</td>
                {shiftTypes.map((s) => (
                  <td key={s.id} className="px-4 py-2">
                    {row.byShiftTypeCode[s.code] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
