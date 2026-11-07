import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

/** ต้อง sync กับ app/schemas.py::SchedulingRule ของ services/ai เป๊ะ ๆ (ADR-0002) */
export interface AiSchedulingRule {
  rule_key: string;
  rule_type: 'HARD' | 'SOFT';
  parameters: Record<string, unknown>;
  weight?: number | null;
}

export interface AiShiftTypeMeta {
  code: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
}

export interface ConflictCheckAssignmentPayload {
  assignment_id: string;
  user_id: string;
  date: string; // "YYYY-MM-DD"
  shift_type_code: string;
}

export interface ConflictCheckRequestPayload {
  hospital_id: string;
  ward_id: string;
  month: number;
  year: number;
  assignments: ConflictCheckAssignmentPayload[];
  shift_types: AiShiftTypeMeta[];
  rules: AiSchedulingRule[];
  approved_leaves?: Array<{ user_id: string; start_date: string; end_date: string }>;
}

export interface ConflictLocation {
  assignment_id?: string | null;
  user_id: string;
  date: string;
  shift_type_code?: string | null;
}

export interface ConflictViolation {
  rule_key: string;
  message: string;
  locations: ConflictLocation[];
}

export interface ConflictCheckResult {
  is_valid: boolean;
  violations: ConflictViolation[];
}

/** ADR-0002: ชั้นเชื่อมต่อกับ services/ai (Python FastAPI) — ดู ai-service.module.ts */
@Injectable()
export class AiServiceClient {
  private readonly logger = new Logger(AiServiceClient.name);

  constructor(private readonly http: HttpService) {}

  async checkConflicts(payload: ConflictCheckRequestPayload): Promise<ConflictCheckResult> {
    try {
      const response = await firstValueFrom(
        this.http.post<ConflictCheckResult>('/api/v1/ai/schedules/check-conflicts', payload),
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(`เรียก AI Service (check-conflicts) ไม่สำเร็จ: ${axiosError.message}`);
      throw new ServiceUnavailableException(
        'ระบบตรวจสอบกฎระเบียบ (AI Service) ไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่อีกครั้ง',
      );
    }
  }
}
