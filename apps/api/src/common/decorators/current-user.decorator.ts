import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  userId: string;
  hospitalId: string;
  role: string;
  wardId: string | null;
}

/** ดึง User context ที่ JwtStrategy แนบไว้กับ request.user (ดู ADR-0003) */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
