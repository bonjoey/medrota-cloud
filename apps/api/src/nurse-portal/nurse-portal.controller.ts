import { Controller, Get, Query } from '@nestjs/common';
import { NursePortalService } from './nurse-portal.service';
import { SchedulePeriodQueryDto } from './dto/schedule-period-query.dto';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/**
 * FR-U01, FR-U02, FR-U05: มุมมองพยาบาล — ไม่มี @Roles() จึงเปิดให้ทุก Role ที่ล็อกอิน
 * แล้วเข้าถึงได้ (รวม NURSE) ตาม RolesGuard (ไม่ประกาศ @Roles = ทุก Role เข้าถึงได้)
 */
@Controller('my')
export class NursePortalController {
  constructor(private readonly nursePortalService: NursePortalService) {}

  // FR-U01: ตารางเวรของแผนกตนเอง (Monthly/List View)
  @Get('department-schedule')
  getDepartmentSchedule(
    @Query() query: SchedulePeriodQueryDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.nursePortalService.getDepartmentSchedule(actor, query.month, query.year);
  }

  // FR-U02: ตารางเวรส่วนตัว + สรุปชั่วโมง/จำนวนเวร
  @Get('schedule')
  getMySchedule(@Query() query: SchedulePeriodQueryDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.nursePortalService.getMySchedule(actor, query.month, query.year);
  }

  // FR-U05: Personal Calendar
  @Get('calendar')
  getMyCalendar(@Query() query: SchedulePeriodQueryDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.nursePortalService.getMyCalendar(actor, query.month, query.year);
  }
}
