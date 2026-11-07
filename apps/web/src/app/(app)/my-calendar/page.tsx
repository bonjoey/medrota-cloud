'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, nursePortalApi, type CalendarEntry } from '@/lib/api-client';
import { Alert, Card, EmptyState, PageHeader, Spinner, inputClass } from '@/components/ui';

const SHIFT_COLORS: Record<string, string> = { M: '#F59E0B', A: '#3B82F6', N: '#4C1D95' };
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/** FR-U05: Personal Calendar — มุมมองปฏิทินรายเดือนของเวรตนเอง */
export default function MyCalendarPage() {
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    nursePortalApi
      .myCalendar(month, year)
      .then(setEntries)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [month, year]);

  const byDay = useMemo(() => {
    const map = new Map<number, CalendarEntry>();
    entries?.forEach((e) => map.set(new Date(e.date).getDate(), e));
    return map;
  }, [entries]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();

  return (
    <div>
      <PageHeader title="ปฏิทินของฉัน" description="มุมมองปฏิทินรายเดือนของเวรที่ประกาศใช้แล้ว (FR-U05)" />

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
      ) : !entries ? null : entries.length === 0 ? (
        <EmptyState label="ไม่มีเวรที่ประกาศใช้ในเดือนนี้" />
      ) : (
        <Card>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400">
            {THAI_WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstWeekday }).map((_, i) => (
              <div key={`blank-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const entry = byDay.get(day);
              return (
                <div key={day} className="aspect-square rounded-md border border-gray-100 p-1 text-xs">
                  <div className="text-gray-400">{day}</div>
                  {entry && (
                    <div
                      className="mt-1 rounded px-1 py-0.5 text-center font-medium text-white"
                      style={{ backgroundColor: SHIFT_COLORS[entry.shiftTypeCode] ?? '#059669' }}
                      title={`${entry.shiftTypeName} ${entry.startTime}-${entry.endTime}`}
                    >
                      {entry.shiftTypeCode}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
