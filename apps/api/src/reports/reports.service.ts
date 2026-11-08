import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { computeShiftHours } from '../common/utils/shift-time.util';

interface ActorContext {
  userId: string;
  hospitalId: string;
  role: string;
  wardId?: string | null;
}

interface ReportRow {
  employeeCode: string;
  fullName: string;
  byDate: Record<string, string>; // "YYYY-MM-DD" -> shiftTypeCode
  totalShifts: number;
  totalHours: number;
}

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

/**
 * FR-R01: รายงานสรุปตารางเวรประจำเดือน พร้อมพิมพ์และส่งออก PDF และ Excel
 *
 * รูปแบบรายงาน: 1 แถวต่อบุคลากร, 1 คอลัมน์ต่อวันในเดือน (แสดงรหัสประเภทเวร),
 * ปิดท้ายด้วยจำนวนเวรรวมและชั่วโมงรวม — ครอบคลุมทั้งไว้พิมพ์ (PDF) และไว้ประมวลผลต่อ (Excel)
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadReportData(scheduleId: string, actor: ActorContext) {
    const schedule = await this.prisma.schedule.findFirst({
      where: { id: scheduleId, hospitalId: actor.hospitalId },
      include: { ward: { include: { hospital: true } } },
    });
    if (!schedule) throw new NotFoundException('ไม่พบตารางเวร');
    if (actor.role === 'HEAD_NURSE' && schedule.wardId !== actor.wardId) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงตารางเวรของ Ward อื่น');
    }

    const assignments = await this.prisma.scheduleAssignment.findMany({
      where: { scheduleId },
      include: {
        user: { select: { fullName: true, employeeCode: true } },
        shiftType: true,
      },
      orderBy: [{ user: { fullName: 'asc' } }, { date: 'asc' }],
    });

    const daysInMonth = new Date(schedule.year, schedule.month, 0).getDate();
    const dateKeys: string[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      dateKeys.push(`${schedule.year}-${String(schedule.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }

    const rowsByUser = new Map<string, ReportRow>();
    for (const a of assignments) {
      const key = a.userId;
      if (!rowsByUser.has(key)) {
        rowsByUser.set(key, {
          employeeCode: a.user.employeeCode,
          fullName: a.user.fullName,
          byDate: {},
          totalShifts: 0,
          totalHours: 0,
        });
      }
      const row = rowsByUser.get(key)!;
      const dateKey = a.date.toISOString().slice(0, 10);
      row.byDate[dateKey] = a.shiftType.code;
      row.totalShifts += 1;
      row.totalHours += computeShiftHours(a.shiftType.startTime, a.shiftType.endTime, a.shiftType.crossesMidnight);
    }

    const rows = Array.from(rowsByUser.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));

    return { schedule, dateKeys, rows };
  }

  async generateExcel(scheduleId: string, actor: ActorContext): Promise<Buffer> {
    const { schedule, dateKeys, rows } = await this.loadReportData(scheduleId, actor);

    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('ตารางเวร');

    const header = ['รหัสพนักงาน', 'ชื่อ-สกุล', ...dateKeys.map((d) => Number(d.slice(8, 10))), 'รวมเวร', 'รวมชั่วโมง'];
    sheet.addRow(header);
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      sheet.addRow([
        row.employeeCode,
        row.fullName,
        ...dateKeys.map((d) => row.byDate[d] ?? ''),
        row.totalShifts,
        Math.round(row.totalHours * 100) / 100,
      ]);
    }

    sheet.columns.forEach((col, idx) => {
      col.width = idx < 2 ? 20 : 6;
    });

    const title = `ตารางเวร Ward ${schedule.ward.name} เดือน ${THAI_MONTHS[schedule.month - 1]} ${schedule.year}`;
    sheet.insertRow(1, [title]);
    sheet.mergeCells(1, 1, 1, header.length);
    sheet.getRow(1).font = { bold: true, size: 14 };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  async generatePdf(scheduleId: string, actor: ActorContext): Promise<Buffer> {
    const { schedule, dateKeys, rows } = await this.loadReportData(scheduleId, actor);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 24 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc
        .fontSize(14)
        .text(
          `ตารางเวร Ward ${schedule.ward.name} — เดือน ${THAI_MONTHS[schedule.month - 1]} ${schedule.year}`,
          { align: 'center' },
        );
      doc.moveDown(0.5);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const nameColWidth = 70;
      const codeColWidth = 55;
      const totalsColWidth = 40;
      const dayColWidth =
        (pageWidth - nameColWidth - codeColWidth - totalsColWidth * 2) / Math.max(dateKeys.length, 1);

      const startX = doc.page.margins.left;
      let y = doc.y;
      const rowHeight = 14;

      const drawRow = (cells: string[], widths: number[], bold = false) => {
        let x = startX;
        doc.fontSize(6).font(bold ? 'Helvetica-Bold' : 'Helvetica');
        cells.forEach((text, i) => {
          doc.text(text, x, y, { width: widths[i], align: 'center', height: rowHeight });
          x += widths[i];
        });
        y += rowHeight;
      };

      const widths = [
        codeColWidth,
        nameColWidth,
        ...dateKeys.map(() => dayColWidth),
        totalsColWidth,
        totalsColWidth,
      ];
      drawRow(
        ['รหัส', 'ชื่อ-สกุล', ...dateKeys.map((d) => d.slice(8, 10)), 'เวร', 'ชม.'],
        widths,
        true,
      );

      for (const row of rows) {
        if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
          doc.addPage({ layout: 'landscape', size: 'A4', margin: 24 });
          y = doc.page.margins.top;
        }
        drawRow(
          [
            row.employeeCode,
            row.fullName,
            ...dateKeys.map((d) => row.byDate[d] ?? '-'),
            String(row.totalShifts),
            String(Math.round(row.totalHours * 100) / 100),
          ],
          widths,
        );
      }

      doc.end();
    });
  }

  // ---------------------------------------------------------------------------
  // FR-R07 (Could Have, MVP 3 Sprint 10): รายงานประวัติการแลกเวรประจำเดือน
  // ---------------------------------------------------------------------------
  async shiftSwapHistory(actor: ActorContext, query: { month: number; year: number }) {
    const monthStart = new Date(query.year, query.month - 1, 1);
    const monthEnd = new Date(query.year, query.month, 1);

    const where: Record<string, unknown> = {
      createdAt: { gte: monthStart, lt: monthEnd },
      requester: { hospitalId: actor.hospitalId },
    };
    if (actor.role === 'HEAD_NURSE') {
      where.OR = [{ requester: { primaryWardId: actor.wardId } }, { counterparty: { primaryWardId: actor.wardId } }];
    }

    const swaps = await this.prisma.shiftSwapRequest.findMany({
      where,
      include: {
        requester: { select: { id: true, fullName: true, employeeCode: true, primaryWard: { select: { name: true } } } },
        counterparty: { select: { id: true, fullName: true, employeeCode: true, primaryWard: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const byStatus: Record<string, number> = {};
    const byWard = new Map<string, number>();
    const byUser = new Map<string, { userId: string; fullName: string; count: number }>();

    for (const s of swaps) {
      byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;

      const wardName = s.requester.primaryWard?.name ?? 'ไม่ระบุ Ward';
      byWard.set(wardName, (byWard.get(wardName) ?? 0) + 1);

      for (const person of [s.requester, s.counterparty]) {
        const row = byUser.get(person.id) ?? { userId: person.id, fullName: person.fullName, count: 0 };
        row.count += 1;
        byUser.set(person.id, row);
      }
    }

    return {
      month: query.month,
      year: query.year,
      total: swaps.length,
      byStatus,
      byWard: Array.from(byWard.entries()).map(([wardName, count]) => ({ wardName, count })),
      byUser: Array.from(byUser.values()).sort((a, b) => b.count - a.count),
      items: swaps,
    };
  }

  // ---------------------------------------------------------------------------
  // FR-R08 (Could Have, MVP 3 Sprint 10): รายงานวิเคราะห์การลาหยุดประจำปี
  // ---------------------------------------------------------------------------
  async leaveAnalysis(actor: ActorContext, query: { year: number }) {
    const yearStart = new Date(query.year, 0, 1);
    const yearEnd = new Date(query.year + 1, 0, 1);

    const where: Record<string, unknown> = {
      startDate: { lt: yearEnd },
      endDate: { gte: yearStart },
      user: { hospitalId: actor.hospitalId },
    };
    if (actor.role === 'HEAD_NURSE') {
      where.user = { hospitalId: actor.hospitalId, primaryWardId: actor.wardId };
    }

    const leaves = await this.prisma.leaveRequest.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, primaryWard: { select: { name: true } } } } },
      orderBy: { startDate: 'asc' },
    });

    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byWard = new Map<string, number>();
    const byMonth = Array.from({ length: 12 }, () => 0);

    for (const l of leaves) {
      byType[l.leaveType] = (byType[l.leaveType] ?? 0) + 1;
      byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
      byWard.set(l.user.primaryWard?.name ?? 'ไม่ระบุ Ward', (byWard.get(l.user.primaryWard?.name ?? 'ไม่ระบุ Ward') ?? 0) + 1);
      byMonth[l.startDate.getMonth()] += 1;
    }

    const decided = (byStatus['APPROVED'] ?? 0) + (byStatus['REJECTED'] ?? 0);
    const approvalRate = decided > 0 ? Math.round(((byStatus['APPROVED'] ?? 0) / decided) * 1000) / 10 : null;

    return {
      year: query.year,
      total: leaves.length,
      byType,
      byStatus,
      approvalRatePercent: approvalRate,
      byWard: Array.from(byWard.entries()).map(([wardName, count]) => ({ wardName, count })),
      byMonth,
      items: leaves,
    };
  }
}
