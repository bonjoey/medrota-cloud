'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canManageHospitalSettings } from '@/lib/roles';
import { ApiError, hospitalApi, type Hospital } from '@/lib/api-client';
import { Alert, Button, Card, Field, PageHeader, Spinner, inputClass } from '@/components/ui';

/** FR-A05: ตั้งค่าโรงพยาบาล/นโยบายองค์กร (SUPER_ADMIN เท่านั้น) */
export default function HospitalSettingsPage() {
  const { user } = useAuth();
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    hospitalApi
      .getMine()
      .then(setHospital)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  if (!user) return null;

  if (!canManageHospitalSettings(user.role)) {
    return <Alert kind="error">หน้านี้สำหรับผู้ดูแลระบบสูงสุดเท่านั้น</Alert>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hospital) return;
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const updated = await hospitalApi.updateMine({
        name: hospital.name,
        address: hospital.address || undefined,
        timezone: hospital.timezone,
        minHoursPerMonth: hospital.minHoursPerMonth ?? undefined,
        maxHoursPerMonth: hospital.maxHoursPerMonth ?? undefined,
      });
      setHospital(updated);
      setSuccess('บันทึกการตั้งค่าเรียบร้อย');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="ตั้งค่าโรงพยาบาล" description="นโยบายระดับองค์กร เช่น ช่วงชั่วโมงทำงานขั้นต่ำ/สูงสุดต่อเดือน (FR-A05)" />

      {error && <Alert kind="error">{error}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}

      {loading || !hospital ? (
        <Spinner />
      ) : (
        <Card className="mt-4 max-w-lg">
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="ชื่อโรงพยาบาล">
              <input
                required
                className={inputClass}
                value={hospital.name}
                onChange={(e) => setHospital({ ...hospital, name: e.target.value })}
              />
            </Field>
            <Field label="ที่อยู่">
              <input
                className={inputClass}
                value={hospital.address ?? ''}
                onChange={(e) => setHospital({ ...hospital, address: e.target.value })}
              />
            </Field>
            <Field label="Time zone">
              <input
                required
                className={inputClass}
                value={hospital.timezone}
                onChange={(e) => setHospital({ ...hospital, timezone: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ชั่วโมงทำงานขั้นต่ำ/เดือน">
                <input
                  type="number"
                  className={inputClass}
                  value={hospital.minHoursPerMonth ?? ''}
                  onChange={(e) =>
                    setHospital({ ...hospital, minHoursPerMonth: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </Field>
              <Field label="ชั่วโมงทำงานสูงสุด/เดือน">
                <input
                  type="number"
                  className={inputClass}
                  value={hospital.maxHoursPerMonth ?? ''}
                  onChange={(e) =>
                    setHospital({ ...hospital, maxHoursPerMonth: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </Field>
            </div>
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
