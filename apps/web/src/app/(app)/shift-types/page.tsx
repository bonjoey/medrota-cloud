'use client';

import { useEffect, useState } from 'react';
import { ApiError, shiftTypesApi, type ShiftType } from '@/lib/api-client';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Spinner, inputClass } from '@/components/ui';

interface FormState {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  compensationRate: string;
}

const emptyForm: FormState = {
  code: '',
  name: '',
  startTime: '08:00',
  endTime: '16:00',
  crossesMidnight: false,
  compensationRate: '1.0',
};

const SHIFT_COLORS: Record<string, string> = {
  M: '#F59E0B',
  A: '#3B82F6',
  N: '#4C1D95',
};

/** FR-A06: จัดการประเภทเวร + อัตราค่าตอบแทน */
export default function ShiftTypesPage() {
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftType | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setShiftTypes(await shiftTypesApi.list());
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

  function openEdit(s: ShiftType) {
    setEditing(s);
    setForm({
      code: s.code,
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      crossesMidnight: s.crossesMidnight,
      compensationRate: s.compensationRate,
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
        code: form.code,
        name: form.name,
        startTime: form.startTime,
        endTime: form.endTime,
        crossesMidnight: form.crossesMidnight,
        compensationRate: Number(form.compensationRate),
      };
      if (editing) {
        await shiftTypesApi.update(editing.id, payload);
      } else {
        await shiftTypesApi.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(s: ShiftType) {
    if (!confirm(`ลบประเภทเวร "${s.name}" ?`)) return;
    try {
      await shiftTypesApi.remove(s.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ (อาจมีตารางเวรใช้งานอยู่)');
    }
  }

  return (
    <div>
      <PageHeader
        title="ประเภทเวร"
        description="กำหนดช่วงเวลาเวรและอัตราค่าตอบแทนของแต่ละประเภท (FR-A06)"
        actions={<Button onClick={openCreate}>+ เพิ่มประเภทเวร</Button>}
      />

      {error && <Alert kind="error">{error}</Alert>}

      <Card className="mt-4 p-0 overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="px-4 py-3">รหัส</th>
                <th className="px-4 py-3">ชื่อเวร</th>
                <th className="px-4 py-3">เวลา</th>
                <th className="px-4 py-3">ข้ามเที่ยงคืน</th>
                <th className="px-4 py-3">อัตราค่าตอบแทน</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shiftTypes.map((s) => (
                <tr key={s.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">
                    <Badge color={SHIFT_COLORS[s.code] ?? '#059669'}>{s.code}</Badge>
                  </td>
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3">
                    {s.startTime} – {s.endTime}
                  </td>
                  <td className="px-4 py-3">{s.crossesMidnight ? 'ใช่' : 'ไม่ใช่'}</td>
                  <td className="px-4 py-3">×{s.compensationRate}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(s)} className="mr-3 text-shift-afternoon hover:underline">
                      แก้ไข
                    </button>
                    <button onClick={() => handleDelete(s)} className="text-risk-critical hover:underline">
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
        <Modal title={editing ? 'แก้ไขประเภทเวร' : 'เพิ่มประเภทเวร'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="รหัสเวร (เช่น M, A, N)">
              <input
                required
                maxLength={10}
                className={inputClass}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="ชื่อเวร">
              <input required className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="เวลาเริ่ม">
                <input
                  type="time"
                  required
                  className={inputClass}
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                />
              </Field>
              <Field label="เวลาสิ้นสุด">
                <input
                  type="time"
                  required
                  className={inputClass}
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.crossesMidnight}
                onChange={(e) => setForm({ ...form, crossesMidnight: e.target.checked })}
              />
              เวรข้ามเที่ยงคืน (เช่น เวรดึก)
            </label>
            <Field label="อัตราค่าตอบแทน (เท่าของฐาน)">
              <input
                type="number"
                step="0.1"
                min="0"
                required
                className={inputClass}
                value={form.compensationRate}
                onChange={(e) => setForm({ ...form, compensationRate: e.target.value })}
              />
            </Field>

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
