/**
 * Client เรียก NestJS ผ่าน /api proxy (ดู next.config.mjs rewrites)
 *
 * NFR-02: จัดการ Access Token (15 นาที) + Refresh Token Rotation โดยอัตโนมัติ —
 * ถ้า request ไหนได้ 401 จะลอง refresh ครั้งเดียวแล้ว retry request เดิมให้
 */
const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function getAccessToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
}

function getRefreshToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;
}

function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  if (!refreshInFlight) {
    refreshInFlight = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const body = await res.json();
        setTokens(body.accessToken, body.refreshToken);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
}

interface RequestOptions extends RequestInit {
  /** ข้ามการแนบ Authorization header (เช่น ตอน login) */
  skipAuth?: boolean;
  /** response เป็นไฟล์ (blob) ไม่ใช่ JSON */
  responseType?: 'json' | 'blob';
}

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const token = options.skipAuth ? null : getAccessToken();

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && !options.skipAuth && !isRetry) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return request<T>(path, options, true);
    }
    clearSession();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError(401, 'กรุณาเข้าสู่ระบบใหม่');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? 'เกิดข้อผิดพลาด', body);
  }

  if (options.responseType === 'blob') {
    return res.blob() as Promise<T>;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const get = <T>(path: string) => request<T>(path, { method: 'GET' });
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Types (ย่อเท่าที่ UI ใช้จริง — Single Source of Truth ของ Response shape คือ NestJS DTO)
// ---------------------------------------------------------------------------

export type Role = 'SUPER_ADMIN' | 'WARD_ADMIN' | 'HEAD_NURSE' | 'NURSE';
export type PositionLevel = 'RN' | 'PN' | 'NA';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';
export type WardType = 'ICU' | 'GENERAL' | 'ER' | 'OTHER';
export type RuleType = 'HARD' | 'SOFT';
export type ScheduleStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PUBLISHED';

export interface CurrentUser {
  id: string;
  fullName: string;
  role: Role;
  hospitalId: string;
  wardId: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
  user: CurrentUser;
}

export interface UserRecord {
  id: string;
  employeeCode: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  role: Role;
  positionLevel: PositionLevel;
  primaryWardId?: string | null;
  status: UserStatus;
  mustChangePassword?: boolean;
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  wards?: Ward[];
}

export interface Ward {
  id: string;
  name: string;
  wardType: WardType;
  departmentId?: string | null;
  department?: Department | null;
  building?: string | null;
}

export interface Hospital {
  id: string;
  name: string;
  address?: string | null;
  logoUrl?: string | null;
  timezone: string;
  minHoursPerMonth?: number | null;
  maxHoursPerMonth?: number | null;
}

export interface ShiftType {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  compensationRate: string;
}

export interface SchedulingRule {
  id: string;
  wardId?: string | null;
  ruleType: RuleType;
  ruleKey: string;
  parameters: Record<string, unknown>;
  weight?: number | null;
  isActive: boolean;
  calibratedAt?: string | null;
}

export interface Schedule {
  id: string;
  hospitalId: string;
  wardId: string;
  ward?: Ward;
  month: number;
  year: number;
  status: ScheduleStatus;
  publishedAt?: string | null;
}

export interface ScheduleAssignment {
  id: string;
  scheduleId: string;
  userId: string;
  user: { id: string; fullName: string; employeeCode: string; positionLevel: PositionLevel };
  shiftTypeId: string;
  shiftType: ShiftType;
  date: string;
  isManualOverride: boolean;
}

export interface ScheduleSummaryRow {
  userId: string;
  fullName: string;
  employeeCode: string;
  totalShifts: number;
  totalHours: number;
  byShiftTypeCode: Record<string, number>;
}

export interface ScheduleDetail extends Schedule {
  assignments: ScheduleAssignment[];
  summary: ScheduleSummaryRow[];
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

export interface ScheduleChangeLog {
  id: string;
  changedById: string;
  changeType: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  reason?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API namespaces
// ---------------------------------------------------------------------------

export const authApi = {
  login: (employeeCodeOrEmail: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ employeeCodeOrEmail, password }),
    }),
  logout: async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      await request('/auth/logout', { method: 'POST', skipAuth: true, body: JSON.stringify({ refreshToken }) }).catch(
        () => undefined,
      );
    }
    clearSession();
  },
};

export interface CreateUserPayload {
  employeeCode: string;
  fullName: string;
  email?: string;
  phone?: string;
  password: string;
  role: Role;
  positionLevel: PositionLevel;
  primaryWardId?: string;
}

export const usersApi = {
  me: () => get<UserRecord>('/users/me'),
  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    post('/users/me/change-password', { currentPassword, newPassword }),
  list: () => get<UserRecord[]>('/users'),
  get: (id: string) => get<UserRecord>(`/users/${id}`),
  create: (data: CreateUserPayload) => post<UserRecord>('/users', data),
  update: (id: string, data: Partial<CreateUserPayload>) => patch<UserRecord>(`/users/${id}`, data),
  suspend: (id: string) => del(`/users/${id}`),
  reactivate: (id: string) => post(`/users/${id}/reactivate`),
};

export const departmentsApi = {
  list: () => get<Department[]>('/departments'),
  create: (name: string) => post<Department>('/departments', { name }),
  update: (id: string, name: string) => patch<Department>(`/departments/${id}`, { name }),
  remove: (id: string) => del(`/departments/${id}`),
};

export interface CreateWardPayload {
  name: string;
  wardType: WardType;
  departmentId?: string;
  building?: string;
}

export const wardsApi = {
  list: () => get<Ward[]>('/wards'),
  get: (id: string) => get<Ward>(`/wards/${id}`),
  create: (data: CreateWardPayload) => post<Ward>('/wards', data),
  update: (id: string, data: Partial<CreateWardPayload>) => patch<Ward>(`/wards/${id}`, data),
  remove: (id: string) => del(`/wards/${id}`),
};

export const hospitalApi = {
  getMine: () => get<Hospital>('/hospitals/mine'),
  updateMine: (data: Partial<Hospital>) => patch<Hospital>('/hospitals/mine', data),
};

export interface CreateShiftTypePayload {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight?: boolean;
  compensationRate: number;
}

export const shiftTypesApi = {
  list: () => get<ShiftType[]>('/shift-types'),
  create: (data: CreateShiftTypePayload) => post<ShiftType>('/shift-types', data),
  update: (id: string, data: Partial<CreateShiftTypePayload>) => patch<ShiftType>(`/shift-types/${id}`, data),
  remove: (id: string) => del(`/shift-types/${id}`),
};

export interface CreateSchedulingRulePayload {
  wardId?: string;
  ruleType: RuleType;
  ruleKey: string;
  parameters: Record<string, unknown>;
  weight?: number;
  isActive?: boolean;
}

export const schedulingRulesApi = {
  list: (wardId?: string) => get<SchedulingRule[]>(`/scheduling-rules${wardId ? `?wardId=${wardId}` : ''}`),
  create: (data: CreateSchedulingRulePayload) => post<SchedulingRule>('/scheduling-rules', data),
  update: (id: string, data: Partial<CreateSchedulingRulePayload>) =>
    patch<SchedulingRule>(`/scheduling-rules/${id}`, data),
  calibrate: (id: string) => post<SchedulingRule>(`/scheduling-rules/${id}/calibrate`),
  remove: (id: string) => del(`/scheduling-rules/${id}`),
};

export const schedulesApi = {
  list: (query: { wardId?: string; month?: number; year?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.wardId) params.set('wardId', query.wardId);
    if (query.month) params.set('month', String(query.month));
    if (query.year) params.set('year', String(query.year));
    const qs = params.toString();
    return get<Schedule[]>(`/schedules${qs ? `?${qs}` : ''}`);
  },
  create: (data: { wardId: string; month: number; year: number }) => post<Schedule>('/schedules', data),
  get: (id: string) => get<ScheduleDetail>(`/schedules/${id}`),
  summary: (id: string) => get<ScheduleSummaryRow[]>(`/schedules/${id}/summary`),
  upsertAssignment: (id: string, data: { userId: string; shiftTypeId: string; date: string }) =>
    put<ScheduleAssignment>(`/schedules/${id}/assignments`, data),
  removeAssignment: (id: string, assignmentId: string) => del(`/schedules/${id}/assignments/${assignmentId}`),
  checkConflicts: (id: string) => post<ConflictCheckResult>(`/schedules/${id}/check-conflicts`),
  changeLogs: (id: string) => get<ScheduleChangeLog[]>(`/schedules/${id}/change-logs`),
  submitForReview: (id: string) => post<Schedule>(`/schedules/${id}/submit-review`),
  approve: (id: string) => post<Schedule>(`/schedules/${id}/approve`),
  publish: (id: string) => post<Schedule>(`/schedules/${id}/publish`),
  sendBack: (id: string, reason: string) => post<Schedule>(`/schedules/${id}/send-back`, { reason }),
  exportUrl: (id: string, format: 'pdf' | 'xlsx') => `${BASE}/schedules/${id}/export?format=${format}`,
};

/** ไม่มีฟิลด์ user เพราะ /my/schedule กรองเฉพาะเวรของตัวเอง (userId = actor.userId) อยู่แล้ว */
export interface PersonalAssignment {
  id: string;
  scheduleId: string;
  userId: string;
  shiftTypeId: string;
  shiftType: ShiftType;
  date: string;
  isManualOverride: boolean;
}

export interface MyScheduleResponse {
  schedule: Schedule | null;
  assignments: PersonalAssignment[];
  summary: { totalShifts: number; totalHours: number; byShiftTypeCode: Record<string, number> };
}

export interface DepartmentScheduleResponse {
  schedule: Schedule | null;
  assignments: ScheduleAssignment[];
}

export interface CalendarEntry {
  date: string;
  shiftTypeCode: string;
  shiftTypeName: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
}

export const nursePortalApi = {
  mySchedule: (month: number, year: number) => get<MyScheduleResponse>(`/my/schedule?month=${month}&year=${year}`),
  myCalendar: (month: number, year: number) => get<CalendarEntry[]>(`/my/calendar?month=${month}&year=${year}`),
  departmentSchedule: (month: number, year: number) =>
    get<DepartmentScheduleResponse>(`/my/department-schedule?month=${month}&year=${year}`),
};

/** ดาวน์โหลดไฟล์ export (ต้องแนบ Authorization header เอง เพราะเป็น Blob ไม่ใช่ JSON) */
export async function downloadScheduleExport(scheduleId: string, format: 'pdf' | 'xlsx') {
  const blob = await request<Blob>(
    `/schedules/${scheduleId}/export?format=${format}`,
    { method: 'GET', responseType: 'blob' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `schedule-${scheduleId}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { getAccessToken };
