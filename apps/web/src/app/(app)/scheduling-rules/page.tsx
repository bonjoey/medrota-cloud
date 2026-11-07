'use client';

import { useEffect, useState } from 'react';
import {
  ApiError,
  schedulingRulesApi,
  shiftTypesApi,
  wardsApi,
  type RuleType,
  type SchedulingRule,
  type ShiftType,
  type Ward,
} from '@/lib/api-client';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Spinner, inputClass } from '@/components/ui';

/** ต้องตรงกับ apps/api/src/common/constants/rule-keys.ts เป๊ะ ๆ (ADR-0002) */
const HARD_RULE_KEYS = ['MIN_STAFF_PER_SHIFT', 'MAX_CONSECUTIVE_NIGHT_SHIFTS', 'MIN_REST_HOURS', 'APPROVED_LEAVE_BLOCK'] as const;
const SOFT_RULE_KEYS = ['NIGHT_SHIFT_FAIRNESS', 'HOLIDAY_SHIFT_FAIRNESS', 'SHIFT_PATTERN_CONTINUITY', 'PERSONAL_PREFERENCE'] as const;

const RULE_LABELS: Record<string, string> = {
  MIN_STAFF_PER_SHIFT: 'จำนวนเจ้าหน้าที่ขั้นต่ำต่อเวร',
  MAX_CONSECUTIVE_NIGHT_SHIFTS: 'จำนวนเวรดึกต่อเนื่องสูงสุด',
  MIN_REST_HOURS: 'ห้าม Quick Return (พักไม่พอระหว่างเวร)',
  APPROVED_LEAVE_BLOCK: 'ห้ามจัดเวรช่วงที่มีใบลาอนุมัติแล้ว (รอ MVP 3)',
  NIGHT_SHIFT_FAIRNESS: 'ความเป็นธรรมของเวรดึก',
  HOLIDAY_SHIFT_FAIRNESS: 'ความเป็นธรรมของเวรวันหยุด',
  SHIFT_PATTERN_CONTINUITY: 'ความต่อเนื่องของรูปแบบเวร',
  PERSONAL_PREFERENCE: 'ความต้องการส่วนบุคคล',
};

interface FormState {
  wardId: string;
  ruleType: RuleType;
  ruleKey: string;
  shiftCode: string;
  min: string;
  maxConsecutiveDays: string;
  weight: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  wardId: '',
  ruleType: 'HARD',
  ruleKey: HARD_RULE_KEYS[0],
  shiftCode: '',
  min: '1',
  maxConsecutiveDays: '3',
  weight: '5',
  isActive: true,
};

function buildParameters(form: FormState): Record<string, unknown> {
  if (form.ruleKey === 'MIN_STAFF_PER_SHIFT') return { shiftCode: form.shiftCode, min: Number(form.min) };
  if (form.ruleKey === 'MAX_CONSECUTIVE_NIGHT_SHIFTS')
    return { shiftCode: form.shiftCode || undefined, maxConsecutiveDays: Number(form.maxConsecutiveDays) };
  return {};
}

/** FR-A07: Hard/Soft Constraint — ข้อมูลนี้คือ Input ตรงของ Solver (MVP 2) และ Conflict Check (Sprint 3) */
export default function SchedulingRulesPage() {
  const [rules, setRules] = useState<SchedulingRule[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SchedulingRule | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [r, w, s] = await Promise.all([schedulingRulesApi.list(), wardsApi.list(), shiftTypesApi.list()]);
      setRules(r);
      setWards(w);
      setShiftTypes(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(r: SchedulingRule) {
    setEditing(r);
    const p = r.parameters as Record<string, unknown>;
    setForm({
      wardId: r.wardId ?? '',
      ruleType: r.ruleType,
      ruleKey: r.ruleKey,
      shiftCode: typeof p.shiftCode === 'string' ? p.shiftCode : '',
      min: typeof p.min === 'number' ? String(p.min) : '1',
      maxConsecutiveDays: typeof p.maxConsecutiveDays === 'number' ? String(p.maxConsecutiveDays) : '3',
      weight: r.weight != null ? String(r.weight) : '5',
      isActive: r.isActive,
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const payload = {
        wardId: form.wardId || undefined,
        ruleType: form.ruleType,
        ruleKey: form.ruleKey,
        parameters: buildParameters(form),
        weight: form.ruleType === 'SOFT' ? Number(form.weight) : undefined,
        isActive: form.isActive,
      };
      if (editing) {
        await schedulingRulesApi.update(editing.id, payload);
      } else {
        await schedulingRulesApi.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r: SchedulingRule) {
    if (!confirm('ลบกฎนี้ ?')) return;
    try {
      await schedulingRulesApi.remove(r.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  async function handleCalibrate(r: SchedulingRule) {
    try {
      await schedulingRulesApi.calibrate(r.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ยืนยันค่าสอบเทียบไม่สำเร็จ');
    }
  }

  const ruleKeyOptions = form.ruleType === 'HARD' ? HARD_RULE_KEYS : SOFT_RULE_KEYS;

  return (
    <div>
      <PageHeader
        title="กฎการจัดเวร"
        description="Hard Constraint บังคับเสมอ, Soft Constraint ให้คะแนนน้ำหนัก — ใช้โดย AI Solver และระบบตรวจความขัดแย้ง (FR-A07, FR-A10)"
        actions={<Button onClick={openCreate}>+ เพิ่มกฎ</Button>}
      />

      {error && <Alert kind="error">{error}</Alert>}

      <Card className="mt-4 p-0 overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="px-4 py-3">ประเภท</th>
                <th className="px-4 py-3">กฎ</th>
                <th className="px-4 py-3">หอผู้ป่วย</th>
                <th className="px-4 py-3">พารามิเตอร์</th>
                <th className="px-4 py-3">น้ำหนัก</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">
                    <Badge color={r.ruleType === 'HARD' ? '#DC2626' : '#3B82F6'}>
                      {r.ruleType === 'HARD' ? 'Hard' : 'Soft'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{RULE_LABELS[r.ruleKey] ?? r.ruleKey}</td>
                  <td className="px-4 py-3">{wards.find((w) => w.id === r.wardId)?.name ?? 'ทั้งโรงพยาบาล'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{JSON.stringify(r.parameters)}</td>
                  <td className="px-4 py-3">{r.weight ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge color={r.isActive ? '#16A34A' : '#9CA3AF'}>{r.isActive ? 'ใช้งาน' : 'ปิด'}</Badge>
                    {r.calibratedAt && <span className="ml-1 text-xs text-gray-400">(สอบเทียบแล้ว)</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {!r.calibratedAt && (
                      <button onClick={() => handleCalibrate(r)} className="mr-3 text-risk-normal hover:underline">
                        ยืนยันสอบเทียบ
                      </button>
                    )}
                    <button onClick={() => openEdit(r)} className="mr-3 text-shift-afternoon hover:underline">
                      แก้ไข
                    </button>
                    <button onClick={() => handleDelete(r)} className="text-risk-critical hover:underline">
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {modalOpen && (
        <Modal title={editing ? 'แก้ไขกฎ' : 'เพิ่มกฎใหม่'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="ประเภทกฎ">
              <select
                className={inputClass}
                value={form.ruleType}
                onChange={(e) => {
                  const ruleType = e.target.value as RuleType;
                  const keys = ruleType === 'HARD' ? HARD_RULE_KEYS : SOFT_RULE_KEYS;
                  setForm({ ...form, ruleType, ruleKey: keys[0] });
                }}
              >
                <option value="HARD">Hard Constraint (บังคับเสมอ)</option>
                <option value="SOFT">Soft Constraint (ให้คะแนนน้ำหนัก)</option>
              </select>
            </Field>
            <Field label="กฎ">
              <select className={inputClass} value={form.ruleKey} onChange={(e) => setForm({ ...form, ruleKey: e.target.value })}>
                {ruleKeyOptions.map((k) => (
                  <option key={k} value={k}>
                    {RULE_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ใช้กับหอผู้ป่วย (ไม่ระบุ = ทั้งโรงพยาบาล)">
              <select className={inputClass} value={form.wardId} onChange={(e) => setForm({ ...form, wardId: e.target.value })}>
                <option value="">— ทั้งโรงพยาบาล —</option>
                {wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>

            {form.ruleKey === 'MIN_STAFF_PER_SHIFT' && (
              <>
                <Field label="ประเภทเวร">
                  <select className={inputClass} value={form.shiftCode} onChange={(e) => setForm({ ...form, shiftCode: e.target.value })}>
                    <option value="">— เลือกประเภทเวร —</option>
                    {shiftTypes.map((s) => (
                      <option key={s.id} value={s.code}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="จำนวนขั้นต่ำ (คน)">
                  <input
                    type="number"
                    min="1"
                    required
                    className={inputClass}
                    value={form.min}
                    onChange={(e) => setForm({ ...form, min: e.target.value })}
                  />
                </Field>
              </>
            )}

            {form.ruleKey === 'MAX_CONSECUTIVE_NIGHT_SHIFTS' && (
              <>
                <Field label="ประเภทเวร (ไม่บังคับ)">
                  <select className={inputClass} value={form.shiftCode} onChange={(e) => setForm({ ...form, shiftCode: e.target.value })}>
                    <option value="">— ทุกประเภทเวร —</option>
                    {shiftTypes.map((s) => (
                      <option key={s.id} value={s.code}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="จำนวนวันต่อเนื่องสูงสุด">
                  <input
                    type="number"
                    min="1"
                    required
                    className={inputClass}
                    value={form.maxConsecutiveDays}
                    onChange={(e) => setForm({ ...form, maxConsecutiveDays: e.target.value })}
                  />
                </Field>
              </>
            )}

            {form.ruleType === 'SOFT' && (
              <Field label="น้ำหนัก (Weight)">
                <input
                  type="number"
                  min="1"
                  required
                  className={inputClass}
                  value={form.weight}
                  onChange={(e) => setForm({ ...form, weight: e.target.value })}
                />
              </Field>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              เปิดใช้งานกฎนี้
            </label>

            {formError && <Alert kind="error">{formError}</Alert>}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
