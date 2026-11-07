'use client';

import { useEffect, useState } from 'react';
import { ApiError, departmentsApi, wardsApi, type Department, type Ward, type WardType } from '@/lib/api-client';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Spinner, inputClass } from '@/components/ui';

const WARD_TYPE_OPTIONS: { value: WardType; label: string }[] = [
  { value: 'ICU', label: 'หน่วยวิกฤต (ICU)' },
  { value: 'GENERAL', label: 'หอผู้ป่วยทั่วไป' },
  { value: 'ER', label: 'ห้องฉุกเฉิน (ER)' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

interface FormState {
  name: string;
  wardType: WardType;
  departmentId: string;
  building: string;
}

const emptyForm: FormState = { name: '', wardType: 'GENERAL', departmentId: '', building: '' };

/** FR-A04: จัดการหอผู้ป่วย (Ward) — หน่วยพื้นฐานที่ใช้จัดตารางเวร (CON-03) */
export default function WardsPage() {
  const [wards, setWards] = useState<Ward[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Ward | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [w, d] = await Promise.all([wardsApi.list(), departmentsApi.list()]);
      setWards(w);
      setDepartments(d);
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

  function openEdit(w: Ward) {
    setEditing(w);
    setForm({
      name: w.name,
      wardType: w.wardType,
      departmentId: w.departmentId ?? '',
      building: w.building ?? '',
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
        name: form.name,
        wardType: form.wardType,
        departmentId: form.departmentId || undefined,
        building: form.building || undefined,
      };
      if (editing) {
        await wardsApi.update(editing.id, payload);
      } else {
        await wardsApi.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(w: Ward) {
    if (!confirm(`ลบหอผู้ป่วย "${w.name}" ?`)) return;
    try {
      await wardsApi.remove(w.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ (อาจมีเจ้าหน้าที่หรือตารางเวรสังกัดอยู่)');
    }
  }

  return (
    <div>
      <PageHeader
        title="หอผู้ป่วย"
        description="หน่วยพื้นฐานของการจัดตารางเวร แต่ละหอมีกฎและเจ้าหน้าที่ของตนเอง (FR-A04)"
        actions={<Button onClick={openCreate}>+ เพิ่มหอผู้ป่วย</Button>}
      />

      {error && <Alert kind="error">{error}</Alert>}

      <Card className="mt-4 p-0 overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="px-4 py-3">ชื่อหอผู้ป่วย</th>
                <th className="px-4 py-3">ประเภท</th>
                <th className="px-4 py-3">แผนก</th>
                <th className="px-4 py-3">อาคาร</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {wards.map((w) => (
                <tr key={w.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">{w.name}</td>
                  <td className="px-4 py-3">
                    <Badge color={w.wardType === 'ICU' ? '#DC2626' : w.wardType === 'ER' ? '#F59E0B' : '#3B82F6'}>
                      {WARD_TYPE_OPTIONS.find((o) => o.value === w.wardType)?.label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{departments.find((d) => d.id === w.departmentId)?.name ?? '—'}</td>
                  <td className="px-4 py-3">{w.building ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(w)} className="mr-3 text-shift-afternoon hover:underline">
                      แก้ไข
                    </button>
                    <button onClick={() => handleDelete(w)} className="text-risk-critical hover:underline">
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
        <Modal title={editing ? 'แก้ไขหอผู้ป่วย' : 'เพิ่มหอผู้ป่วย'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="ชื่อหอผู้ป่วย">
              <input
                required
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="ประเภท">
              <select
                className={inputClass}
                value={form.wardType}
                onChange={(e) => setForm({ ...form, wardType: e.target.value as WardType })}
              >
                {WARD_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="แผนก (ไม่บังคับ)">
              <select
                className={inputClass}
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              >
                <option value="">— ไม่ระบุ —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="อาคาร (ไม่บังคับ)">
              <input
                className={inputClass}
                value={form.building}
                onChange={(e) => setForm({ ...form, building: e.target.value })}
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
