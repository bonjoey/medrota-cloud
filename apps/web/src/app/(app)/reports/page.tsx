'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, reportsApi, type LeaveAnalysisReport, type ShiftSwapHistoryReport } from '@/lib/api-client';
import { Alert, Card, PageHeader, Spinner, inputClass } from '@/components/ui';

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const LEAVE_TYPE_LABELS: Record<string, string> = {
  SICK: 'ลาป่วย',
  VACATION: 'ลาพักผ่อน',
  PERSONAL: 'ลากิจ',
  EMERGENCY: 'ลาฉุกเฉิน',
  OTHER: 'อื่น ๆ',
};

const SWAP_STATUS_LABELS: Record<string, string> = {
  PENDING_COUNTERPARTY: 'รอคู่สลับตอบรับ',
  PENDING_ADMIN_APPROVAL: 'รอ Admin อนุมัติ',
  APPROVED: 'สำเร็จ',
  REJECTED: 'ถูกปฏิเสธ',
  CANCELLED: 'ยกเลิก',
  EXPIRED: 'หมดอายุ',
};

const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอการอนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ถูกปฏิเสธ',
  CANCELLED: 'ยกเลิกแล้ว',
};

/** FR-R07 (ประวัติการแลกเวร) + FR-R08 (วิเคราะห์การลาหยุด) — MVP 3 Sprint 10, Could Have */
export default function ReportsPage() {
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [swapReport, setSwapReport] = useState<ShiftSwapHistoryReport | null>(null);
  const [leaveReport, setLeaveReport] = useState<LeaveAnalysisReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([reportsApi.shiftSwapHistory(month, year), reportsApi.leaveAnalysis(year)])
      .then(([swap, leave]) => {
        setSwapReport(swap);
        setLeaveReport(leave);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดรายงานไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [month, year]);

  return (
    <div>
      <PageHeader title="รายงาน" description="สรุปการแลกเวร (FR-R07) และวิเคราะห์การลาหยุด (FR-R08)" />

      <div className="mb-4 flex gap-2">
        <select className={`${inputClass} max-w-[160px]`} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {THAI_MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="number"
          className={`${inputClass} max-w-[120px]`}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-base font-semibold">ประวัติการแลกเวร — {THAI_MONTHS[month - 1]} {year}</h2>
            {!swapReport || swapReport.total === 0 ? (
              <p className="text-sm text-gray-400">ไม่มีคำขอแลกเวรในเดือนนี้</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Card>
                  <p className="text-xs text-gray-400">คำขอแลกเวรทั้งหมด</p>
                  <p className="text-2xl font-semibold">{swapReport.total}</p>
                  <div className="mt-2 space-y-1 text-xs text-gray-500">
                    {Object.entries(swapReport.byStatus).map(([status, count]) => (
                      <div key={status} className="flex justify-between">
                        <span>{SWAP_STATUS_LABELS[status] ?? status}</span>
                        <span>{count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card>
                  <p className="mb-2 text-xs text-gray-400">แยกตาม Ward</p>
                  <div className="space-y-1 text-sm">
                    {swapReport.byWard.map((w) => (
                      <div key={w.wardName} className="flex justify-between">
                        <span>{w.wardName}</span>
                        <span className="font-medium">{w.count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card>
                  <p className="mb-2 text-xs text-gray-400">บุคลากรที่เกี่ยวข้องมากที่สุด</p>
                  <div className="space-y-1 text-sm">
                    {swapReport.byUser.slice(0, 5).map((u) => (
                      <div key={u.userId} className="flex justify-between">
                        <span>{u.fullName}</span>
                        <span className="font-medium">{u.count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold">วิเคราะห์การลาหยุด — ปี {year}</h2>
            {!leaveReport || leaveReport.total === 0 ? (
              <p className="text-sm text-gray-400">ไม่มีคำขอลาในปีนี้</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Card>
                  <p className="text-xs text-gray-400">คำขอลาทั้งหมด</p>
                  <p className="text-2xl font-semibold">{leaveReport.total}</p>
                  {leaveReport.approvalRatePercent !== null && (
                    <p className="mt-1 text-xs text-gray-500">อัตราอนุมัติ {leaveReport.approvalRatePercent}%</p>
                  )}
                </Card>
                <Card>
                  <p className="mb-2 text-xs text-gray-400">แยกตามประเภทการลา</p>
                  <div className="space-y-1 text-sm">
                    {Object.entries(leaveReport.byType).map(([type, count]) => (
                      <div key={type} className="flex justify-between">
                        <span>{LEAVE_TYPE_LABELS[type] ?? type}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card>
                  <p className="mb-2 text-xs text-gray-400">แยกตามสถานะ</p>
                  <div className="space-y-1 text-sm">
                    {Object.entries(leaveReport.byStatus).map(([status, count]) => (
                      <div key={status} className="flex justify-between">
                        <span>{LEAVE_STATUS_LABELS[status] ?? status}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card className="md:col-span-3">
                  <p className="mb-2 text-xs text-gray-400">แนวโน้มรายเดือน</p>
                  <div className="flex items-end gap-1" style={{ height: 80 }}>
                    {leaveReport.byMonth.map((count, i) => {
                      const max = Math.max(...leaveReport.byMonth, 1);
                      return (
                        <div key={i} className="flex flex-1 flex-col items-center gap-1">
                          <div
                            className="w-full rounded-sm bg-shift-night"
                            style={{ height: `${(count / max) * 60 + (count > 0 ? 4 : 0)}px` }}
                            title={`${THAI_MONTHS[i]}: ${count}`}
                          />
                          <span className="text-[10px] text-gray-400">{THAI_MONTHS[i].slice(0, 3)}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
                <Card>
                  <p className="mb-2 text-xs text-gray-400">แยกตาม Ward</p>
                  <div className="space-y-1 text-sm">
                    {leaveReport.byWard.map((w) => (
                      <div key={w.wardName} className="flex justify-between">
                        <span>{w.wardName}</span>
                        <span className="font-medium">{w.count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
