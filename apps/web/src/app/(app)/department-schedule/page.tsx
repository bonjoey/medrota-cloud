'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, nursePortalApi, type DepartmentScheduleResponse } from '@/lib/api-client';
import { Alert, Card, EmptyState, PageHeader, Spinner, inputClass } from '@/components/ui';

const SHIFT_COLORS: Record<string, string> = { M: '#F59E0B', A: '#3B82F6', N: '#4C1D95' };
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** FR-U01: มุมมองตารางเวรของหน่วยงาน (หอผู้ป่วยของตนเอง) — เห็นเฉพาะที่ประกาศใช้แล้ว ทุกคนในหอดูได้ */
export default function DepartmentSchedulePage() {
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<DepartmentScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    nursePortalApi
      .departmentSchedule(month, year)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [month, year]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const dateStrings = Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad2(month)}-${pad2(i + 1)}`);

  const people = useMemo(() => {
    const map = new Map<string, { id: string; fullName: string; employeeCode: string }>();
    data?.assignments.forEach((a) => map.set(a.userId, a.user));
    return Array.from(map.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [data]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, DepartmentScheduleResponse['assignments'][number]>();
    data?.assignments.forEach((a) => map.set(`${a.userId}_${a.date.slice(0, 10)}`, a));
    return map;
  }, [data]);

  return (
    <div>
      <PageHeader title="ตารางเวรหน่วยงาน" description="ตารางเวรของหอผู้ป่วยตนเองที่ประกาศใช้แล้ว (FR-U01)" />

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
        <Card className="overflow-x-auto p-0">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[160px] border-b border-r border-gray-200 bg-white px-3 py-2 text-left">
                  บุคลากร
                </th>
                {dateStrings.map((d, i) => {
                  const weekday = new Date(year, month - 1, i + 1).getDay();
                  return (
                    <th
                      key={d}
                      className={`min-w-[40px] border-b border-gray-200 px-1 py-2 text-center font-normal ${
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
              {people.map((person) => (
                <tr key={person.id}>
                  <td className="sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-3 py-2">
                    <div className="font-medium">{person.fullName}</div>
                    <div className="text-xs text-gray-400">{person.employeeCode}</div>
                  </td>
                  {dateStrings.map((d) => {
                    const a = assignmentMap.get(`${person.id}_${d}`);
                    return (
                      <td key={d} className="border-b border-gray-100 p-1 text-center">
                        {a && (
                          <span
                            className="inline-block w-8 rounded text-xs font-medium text-white"
                            style={{ backgroundColor: SHIFT_COLORS[a.shiftType.code] ?? '#059669' }}
                            title={a.shiftType.name}
                          >
                            {a.shiftType.code}
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
      )}
    </div>
  );
}
