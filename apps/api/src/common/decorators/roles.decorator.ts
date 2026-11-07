import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * FR-A02: Role-Based Access Control
 * ใช้ร่วมกับ RolesGuard — ประกาศบน Controller/Handler ว่า Role ใดเข้าถึงได้
 *
 * @example @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
