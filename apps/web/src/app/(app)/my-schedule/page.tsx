'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, nursePortalApi, type MyScheduleResponse } from '@/lib/api-client';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, inputClass } from '@/components/ui';

const SHIFT_COLORS: Record<string, string> = { M: '#F59E0B', A: '#3B82F6', N: '#4C1D95' };
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** FR-U02: มุมมองตารางเวรส่วนตัว พร้อมสรุปชั่วโมงและจำนวนเวร — เห็นเฉพาะที่ประกาศใช้แล้ว */
export default function MySchedulePage() {
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<MyScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    nursePortalApi
      .mySchedule(month, year)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [month, year]);

  return (
    <div>
      <PageHeader title="เวรของฉัน" description="ตารางเวรส่วนตัวที่ประกาศใช้แล้ว พร้อมสรุปชั่วโมงทำงาน (FR-U02)" />

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
      ) : !data?.schedule ? (
        <EmptyState label="ยังไม่มีตารางเวรที่ประกาศใช้สำหรับเดือนนี้" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Card>
              <p className="text-xs text-gray-400">จำนวนเวรทั้งหมด</p>
              <p className="text-2xl font-semibold">{data.summary.totalShifts}</p>
            </Card>
            <Card>
              <p className="text-xs text-gray-400">ชั่วโมงรวม</p>
              <p className="text-2xl font-semibold">{data.summary.totalHours.toFixed(1)}</p>
            </Card>
            <Card>
              <p className="text-xs text-gray-400">แยกตามประเภทเวร</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.entries(data.summary.byShiftTypeCode).map(([code, count]) => (
                  <Badge key={code} color={SHIFT_COLORS[code] ?? '#059669'}>
                    {code}: {count}
                  </Badge>
                ))}
              </div>
            </Card>
          </div>

          <Card className="p-0">
            {data.assignments.length === 0 ? (
              <EmptyState label="ไม่มีเวรที่มอบหมายในเดือนนี้" />
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-gray-500">
                  <tr>
                    <th className="px-4 py-3">วันที่</th>
                    <th className="px-4 py-3">เวร</th>
                    <th className="px-4 py-3">เวลา</th>
                  </tr>
                </thead>
                <tbody>
                  {data.assignments.map((a) => (
                    <tr key={a.id} className="border-b border-gray-100">
                      <td className="px-4 py-3">
                        {new Date(a.date).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={SHIFT_COLORS[a.shiftType.code] ?? '#059669'}>{a.shiftType.code}</Badge>{' '}
                        {a.shiftType.name}
                      </td>
                      <td className="px-4 py-3">
                        {a.shiftType.startTime} – {a.shiftType.endTime}
                        {a.shiftType.crossesMidnight && <span className="ml-1 text-xs text-gray-400">(ข้ามคืน)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
