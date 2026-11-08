import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WardsModule } from './wards/wards.module';
import { DepartmentsModule } from './departments/departments.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { ShiftTypesModule } from './shift-types/shift-types.module';
import { SchedulingRulesModule } from './scheduling-rules/scheduling-rules.module';
import { SchedulesModule } from './schedules/schedules.module';
import { NursePortalModule } from './nurse-portal/nurse-portal.module';
import { ReportsModule } from './reports/reports.module';
import { AiJobModule } from './ai-job/ai-job.module';
import { LeavesModule } from './leaves/leaves.module';
import { ShiftSwapsModule } from './shift-swaps/shift-swaps.module';
import { NotificationsModule } from './notifications/notifications.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditLogModule,
    AuthModule,
    UsersModule,
    WardsModule,
    DepartmentsModule,
    HospitalsModule,
    ShiftTypesModule,
    SchedulingRulesModule,
    SchedulesModule,
    NursePortalModule,
    ReportsModule,
    AiJobModule,
    LeavesModule,
    ShiftSwapsModule,
    NotificationsModule,
  ],
  providers: [
    // ลำดับสำคัญ: JwtAuthGuard ต้องรันก่อน RolesGuard เสมอ (ต้องมี req.user ก่อนจึงเช็ค role ได้)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
