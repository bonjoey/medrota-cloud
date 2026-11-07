import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeShiftHours } from '../common/utils/shift-time.util';

interface ActorContext {
  userId: string;
  hospitalId: string;
  role: string;
  wardId?: string | null;
}

/**
 * FR-U01: มุมมองพยาบาล ดูตารางเวรของแผนก (Monthly/List)
 * FR-U02: มุมมองพยาบาล ดูตารางเวรส่วนตัวพร้อมสรุปชั่วโมงและจำนวนเวร
 * FR-U05: Personal Calendar แสดงเวร วันหยุด และกิจกรรมของแผนก
 *
 * หลักการสำคัญ: บุคลากรเห็นได้เฉพาะตารางเวรที่ PUBLISHED แล้วเท่านั้น (ไม่เห็น Draft/
 * Review/Approved ที่ยังไม่ประกาศใช้ — ป้องกันความสับสนและการรั่วไหลของข้อมูลที่ยังไม่
 * สิ้นสุด) ต่างจาก Admin ที่ใช้ SchedulesService เห็นได้ทุกสถานะ
 */
@Injectable()
export class NursePortalService {
  constructor(private readonly prisma: PrismaService) {}

  private requireOwnWard(actor: ActorContext): string {
    if (!actor.wardId) {
      throw new BadRequestException('บัญชีนี้ยังไม่ได้กำหนด Ward หลัก กรุณาติดต่อ Admin');
    }
    return actor.wardId;
  }

  /** FR-U01: ตารางเวรของแผนกตนเอง (เฉพาะที่ประกาศใช้แล้ว) */
  async getDepartmentSchedule(actor: ActorContext, month: number, year: number) {
    const wardId = this.requireOwnWard(actor);

    const schedule = await this.prisma.schedule.findFirst({
      where: { wardId, month, year, status: 'PUBLISHED', hospitalId: actor.hospitalId },
    });
    if (!schedule) {
      return { schedule: null, assignments: [] };
    }

    const assignments = await this.prisma.scheduleAssignment.findMany({
      where: { scheduleId: schedule.id },
      include: {
        user: { select: { id: true, fullName: true, employeeCode: true, positionLevel: true } },
        shiftType: true,
      },
      orderBy: [{ date: 'asc' }, { user: { fullName: 'asc' } }],
    });

    return { schedule, assignments };
  }

  /** FR-U02: ตารางเวรส่วนตัว + สรุปชั่วโมง/จำนวนเวร */
  async getMySchedule(actor: ActorContext, month: number, year: number) {
    const wardId = this.requireOwnWard(actor);

    const schedule = await this.prisma.schedule.findFirst({
      where: { wardId, month, year, status: 'PUBLISHED', hospitalId: actor.hospitalId },
    });
    if (!schedule) {
      return { schedule: null, assignments: [], summary: { totalShifts: 0, totalHours: 0, byShiftTypeCode: {} } };
    }

    const assignments = await this.prisma.scheduleAssignment.findMany({
      where: { scheduleId: schedule.id, userId: actor.userId },
      include: { shiftType: true },
      orderBy: { date: 'asc' },
    });

    let totalHours = 0;
    const byShiftTypeCode: Record<string, number> = {};
    for (const a of assignments) {
      totalHours += computeShiftHours(a.shiftType.startTime, a.shiftType.endTime, a.shiftType.crossesMidnight);
      byShiftTypeCode[a.shiftType.code] = (byShiftTypeCode[a.shiftType.code] ?? 0) + 1;
    }

    return {
      schedule,
      assignments,
      summary: { totalShifts: assignments.length, totalHours, byShiftTypeCode },
    };
  }

  /** FR-U05: Personal Calendar — รูปแบบพร้อมใช้กับ UI Calendar (1 รายการต่อวัน) */
  async getMyCalendar(actor: ActorContext, month: number, year: number) {
    const { assignments } = await this.getMySchedule(actor, month, year);
    return assignments.map((a) => ({
      date: a.date,
      shiftTypeCode: a.shiftType.code,
      shiftTypeName: a.shiftType.name,
      startTime: a.shiftType.startTime,
      endTime: a.shiftType.endTime,
      crossesMidnight: a.shiftType.crossesMidnight,
    }));
    // หมายเหตุ: วันลา/กิจกรรมแผนกจะรวมเข้ามาใน MVP 3 Sprint 9 เมื่อ LeaveRequest พร้อมใช้งาน
  }

  /** ตรวจสิทธิ์ก่อนให้พยาบาลคนอื่นดูตารางของ user_id ที่ไม่ใช่ตนเอง (กัน Data Leak ส่วนบุคคล) */
  assertSelfOrSupervisor(targetUserId: string, actor: ActorContext) {
    const isSelf = targetUserId === actor.userId;
    const isSupervisor = actor.role === 'HEAD_NURSE' || actor.role === 'WARD_ADMIN' || actor.role === 'SUPER_ADMIN';
    if (!isSelf && !isSupervisor) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลตารางเวรของผู้อื่น');
    }
  }
}
