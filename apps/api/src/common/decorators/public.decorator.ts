import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** ใช้กับ Route ที่ไม่ต้อง Auth เช่น /auth/login, /auth/oauth/:provider */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
