/**
 * คำนวณความยาวเวร (ชั่วโมง) จาก startTime/endTime รูปแบบ "HH:MM"
 * ใช้ร่วมกันระหว่าง ShiftTypes (ตรวจความสมเหตุสมผลตอนสร้าง) และ Schedules (คำนวณสรุปชั่วโมง)
 *
 * crossesMidnight=true หมายถึงเวรที่ endTime "วันถัดไป" เช่น 20:00-08:00 (ข้ามเที่ยงคืน)
 */
export function computeShiftHours(startTime: string, endTime: string, crossesMidnight: boolean): number {
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  const startMin = toMinutes(startTime);
  let endMin = toMinutes(endTime);

  if (crossesMidnight || endMin <= startMin) {
    endMin += 24 * 60;
  }

  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}
