'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canManageUsers } from '@/lib/roles';
import {
  ApiError,
  usersApi,
  wardsApi,
  type PositionLevel,
  type Role,
  type UserRecord,
  type Ward,
} from '@/lib/api-client';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Spinner, inputClass } from '@/components/ui';

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'SUPER_ADMIN', label: 'ผู้ดูแลระบบสูงสุด' },
  { value: 'WARD_ADMIN', label: 'ผู้ดูแลระบบโรงพยาบาล' },
  { value: 'HEAD_NURSE', label: 'หัวหน้าพยาบาล' },
  { value: 'NURSE', label: 'พยาบาล' },
];

const POSITION_OPTIONS: { value: PositionLevel; label: string }[] = [
  { value: 'RN', label: 'พยาบาลวิชาชีพ (RN)' },
  { value: 'PN', label: 'พยาบาลเทคนิค (PN)' },
  { value: 'NA', label: 'ผู้ช่วยพยาบาล (NA)' },
];

interface FormState {
  employeeCode: string;
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: Role;
  positionLevel: PositionLevel;
  primaryWardId: string;
}

const emptyForm: FormState = {
  employeeCode: '',
  fullName: '',
  email: '',
  phone: '',
  password: '',
  role: 'NURSE',
  positionLevel: 'RN',
  primaryWardId: '',
};

/** FR-A01: จัดการผู้ใช้งาน — เพิ่ม แก้ไข ระงับ/คืนสิทธิ์บัญชี กำหนดบทบาทและสังกัดหอผู้ป่วย */
export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [u, w] = await Promise.all([usersApi.list(), wardsApi.list()]);
      setUsers(u);
      setWards(w);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!me) return null;
  const canEdit = canManageUsers(me.role);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(u: UserRecord) {
    setEditing(u);
    setForm({
      employeeCode: u.employeeCode,
      fullName: u.fullName,
      email: u.email ?? '',
      phone: u.phone ?? '',
      password: '',
      role: u.role,
      positionLevel: u.positionLevel,
      primaryWardId: u.primaryWardId ?? '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      if (editing) {
        await usersApi.update(editing.id, {
          fullName: form.fullName,
          email: form.email || undefined,
          phone: form.phone || undefined,
          role: form.role,
          positionLevel: form.positionLevel,
          primaryWardId: form.primaryWardId || undefined,
        });
      } else {
        await usersApi.create({
          employeeCode: form.employeeCode,
          fullName: form.fullName,
          email: form.email || undefined,
          phone: form.phone || undefined,
          password: form.password,
          role: form.role,
          positionLevel: form.positionLevel,
          primaryWardId: form.primaryWardId || undefined,
        });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(u: UserRecord) {
    try {
      if (u.status === 'ACTIVE') {
        await usersApi.suspend(u.id);
      } else {
        await usersApi.reactivate(u.id);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ดำเนินการไม่สำเร็จ');
    }
  }

  return (
    <div>
      <PageHeader
        title="ผู้ใช้งาน"
        description="จัดการบัญชีผู้ใช้ กำหนดบทบาทและสังกัดหอผู้ป่วย (FR-A01, FR-A02)"
        actions={canEdit ? <Button onClick={openCreate}>+ เพิ่มผู้ใช้</Button> : undefined}
      />

      {error && <Alert kind="error">{error}</Alert>}

      <Card className="mt-4 overflow-x-auto p-0">
        {loading ? (
          <Spinner />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="px-4 py-3">รหัส</th>
                <th className="px-4 py-3">ชื่อ-สกุล</th>
                <th className="px-4 py-3">บทบาท</th>
                <th className="px-4 py-3">ตำแหน่ง</th>
                <th className="px-4 py-3">หอผู้ป่วย</th>
                <th className="px-4 py-3">สถานะ</th>
                {canEdit && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">{u.employeeCode}</td>
                  <td className="px-4 py-3">{u.fullName}</td>
                  <td className="px-4 py-3">{ROLE_OPTIONS.find((r) => r.value === u.role)?.label}</td>
                  <td className="px-4 py-3">{u.positionLevel}</td>
                  <td className="px-4 py-3">{wards.find((w) => w.id === u.primaryWardId)?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge color={u.status === 'ACTIVE' ? '#16A34A' : '#9CA3AF'}>
                      {u.status === 'ACTIVE' ? 'ใช้งาน' : 'ระงับ'}
                    </Badge>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(u)} className="mr-3 text-shift-afternoon hover:underline">
                        แก้ไข
                      </button>
                      <button
                        onClick={() => toggleStatus(u)}
                        className={u.status === 'ACTIVE' ? 'text-risk-critical hover:underline' : 'text-risk-normal hover:underline'}
                      >
                        {u.status === 'ACTIVE' ? 'ระงับ' : 'คืนสิทธิ์'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {modalOpen && (
        <Modal title={editing ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            {!editing && (
              <Field label="รหัสประจำตัว">
                <input
                  required
                  className={inputClass}
                  value={form.employeeCode}
                  onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                />
              </Field>
            )}
            <Field label="ชื่อ-สกุล">
              <input
                required
                className={inputClass}
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </Field>
            <Field label="อีเมล (ไม่บังคับ)">
              <input
                type="email"
                className={inputClass}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="เบอร์โทร (ไม่บังคับ)">
              <input
                className={inputClass}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            {!editing && (
              <Field label="รหัสผ่านเริ่มต้น">
                <input
                  type="password"
                  required
                  minLength={8}
                  className={inputClass}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Field>
            )}
            <Field label="บทบาท">
              <select
                className={inputClass}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ตำแหน่ง">
              <select
                className={inputClass}
                value={form.positionLevel}
                onChange={(e) => setForm({ ...form, positionLevel: e.target.value as PositionLevel })}
              >
                {POSITION_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="หอผู้ป่วยหลัก (ไม่บังคับ)">
              <select
                className={inputClass}
                value={form.primaryWardId}
                onChange={(e) => setForm({ ...form, primaryWardId: e.target.value })}
              >
                <option value="">— ไม่ระบุ —</option>
                {wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
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
