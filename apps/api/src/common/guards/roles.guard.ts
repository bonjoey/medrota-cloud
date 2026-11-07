import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * FR-A02: ตรวจสิทธิ์ระดับ Endpoint ตาม Role ของผู้ใช้ (JwtStrategy ต้องรันมาก่อนเสมอ)
 *
 * หมายเหตุสำคัญ: Guard นี้ตรวจแค่ "Role เข้าถึง Endpoint นี้ได้หรือไม่" เท่านั้น
 * การตรวจสิทธิ์ระดับ Resource (เช่น HeadNurse แก้ไขได้เฉพาะ Ward ของตน ตาม ADR-0003)
 * ต้องทำเพิ่มในแต่ละ Service ผ่าน RequestContextService.wardId
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // ไม่ประกาศ @Roles() = ทุก Role ที่ล็อกอินแล้วเข้าถึงได้
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user?.role);
  }
}
