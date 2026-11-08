import { PrismaService } from '../../prisma/prisma.service';

/**
 * FR-A10/FR-AI01 (MVP 3 Sprint 9): ดึงคำขอลาที่ "อนุมัติแล้ว" ของ Ward ที่คาบเกี่ยวกับช่วง
 * วันที่ระบุ แปลงเป็นรูปแบบที่ services/ai ต้องการ (approved_leaves) — ใช้ร่วมกันระหว่าง
 * ai-job.service.ts (FR-AI01 Suggest), schedules.service.ts (FR-A10 Check-conflicts) และ
 * shift-swaps.service.ts (FR-A12 Swap preview) เพื่อไม่ให้แต่ละที่ query/map ต่างกันเอง
 * (ADR-0002 — ห้ามมีตรรกะกฎสองชุดที่ตีความไม่ตรงกัน)
 */
export async function fetchApprovedLeavesPayload(
  prisma: PrismaService,
  wardId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<Array<{ user_id: string; start_date: string; end_date: string }>> {
  const approvedLeaves = await prisma.leaveRequest.findMany({
    where: {
      status: 'APPROVED',
      user: { primaryWardId: wardId },
      startDate: { lte: monthEnd },
      endDate: { gte: monthStart },
    },
  });

  return approvedLeaves.map((l) => ({
    user_id: l.userId,
    start_date: l.startDate.toISOString().slice(0, 10),
    end_date: l.endDate.toISOString().slice(0, 10),
  }));
}
