'use client';

import { useEffect, useState } from 'react';
import { ApiError, departmentsApi, type Department } from '@/lib/api-client';
import { Alert, Button, Card, Field, Modal, PageHeader, Spinner, inputClass } from '@/components/ui';

/** FR-A04: จัดการแผนก (Department) — กลุ่มของหอผู้ป่วยหลายหอ */
export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setDepartments(await departmentsApi.list());
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
    setName('');
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(d: Department) {
    setEditing(d);
    setName(d.name);
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      if (editing) {
        await departmentsApi.update(editing.id, name);
      } else {
        await departmentsApi.create(name);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(d: Department) {
    if (!confirm(`ลบแผนก "${d.name}" ?`)) return;
    try {
      await departmentsApi.remove(d.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ (อาจมีหอผู้ป่วยสังกัดอยู่)');
    }
  }

  return (
    <div>
      <PageHeader title="แผนก" description="จัดกลุ่มหอผู้ป่วยภายใต้แผนก (FR-A04)" actions={<Button onClick={openCreate}>+ เพิ่มแผนก</Button>} />

      {error && <Alert kind="error">{error}</Alert>}

      <Card className="mt-4 p-0">
        {loading ? (
          <Spinner />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="px-4 py-3">ชื่อแผนก</th>
                <th className="px-4 py-3">จำนวนหอผู้ป่วย</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">{d.name}</td>
                  <td className="px-4 py-3">{d.wards?.length ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(d)} className="mr-3 text-shift-afternoon hover:underline">
                      แก้ไข
                    </button>
                    <button onClick={() => handleDelete(d)} className="text-risk-critical hover:underline">
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
        <Modal title={editing ? 'แก้ไขแผนก' : 'เพิ่มแผนก'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="ชื่อแผนก">
              <input required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
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
