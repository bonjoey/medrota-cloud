/**
 * Bootstrap Seed — สร้าง Hospital (Tenant) แรกและบัญชี SuperAdmin คนแรก
 *
 * ระบบ Multi-Tenant นี้ไม่มีหน้า "สมัครโรงพยาบาลใหม่" ในขอบเขต MVP 1 (การ Onboarding
 * Tenant ใหม่เป็นงานปฏิบัติการนอกขอบเขต PRD) — ดังนั้น Hospital/SuperAdmin ชุดแรกต้อง
 * สร้างผ่าน Seed Script นี้เท่านั้น รันด้วย: npx prisma db seed
 *
 * ตั้งค่าได้ผ่าน Environment Variable (ดู .env.example):
 *   SEED_HOSPITAL_NAME, SEED_SUPERADMIN_EMPLOYEE_CODE, SEED_SUPERADMIN_EMAIL,
 *   SEED_SUPERADMIN_PASSWORD, SEED_SUPERADMIN_FULLNAME
 *
 * หมายเหตุ: ใช้ hash scheme เดียวกับ AuthService.hashPassword (scrypt) ตั้งใจ Duplicate
 * โค้ดเล็กน้อยไว้ที่นี่ เพราะ Seed Script รันนอก Nest DI Container
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  const hospitalName = process.env.SEED_HOSPITAL_NAME ?? 'โรงพยาบาลตัวอย่าง (Demo Hospital)';
  const employeeCode = process.env.SEED_SUPERADMIN_EMPLOYEE_CODE ?? 'SA0001';
  const email = process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@example.com';
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe123';
  const fullName = process.env.SEED_SUPERADMIN_FULLNAME ?? 'ผู้ดูแลระบบสูงสุด';

  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error(
      'SEED_SUPERADMIN_PASSWORD ต้องมีอย่างน้อย 8 ตัวอักษร และมีทั้งตัวอักษรกับตัวเลข (NFR-02 Password Policy)',
    );
  }

  let hospital = await prisma.hospital.findFirst({ where: { name: hospitalName } });
  if (!hospital) {
    hospital = await prisma.hospital.create({ data: { name: hospitalName } });
    console.log(`สร้าง Hospital ใหม่: ${hospital.name} (${hospital.id})`);
  } else {
    console.log(`พบ Hospital อยู่แล้ว: ${hospital.name} (${hospital.id}) — ข้ามการสร้างซ้ำ`);
  }

  const existingAdmin = await prisma.user.findUnique({ where: { employeeCode } });
  if (existingAdmin) {
    console.log(`พบบัญชี SuperAdmin อยู่แล้ว (${employeeCode}) — ข้ามการสร้างซ้ำ`);
  } else {
    const admin = await prisma.user.create({
      data: {
        hospitalId: hospital.id,
        employeeCode,
        fullName,
        email,
        passwordHash: hashPassword(password),
        role: 'SUPER_ADMIN',
        positionLevel: 'RN',
        mustChangePassword: true,
      },
    });
    console.log(`สร้างบัญชี SuperAdmin: ${admin.employeeCode} / ${admin.email}`);
    console.log(`รหัสผ่านเริ่มต้น: ${password} (ระบบจะบังคับให้เปลี่ยนในการเข้าสู่ระบบครั้งแรก)`);
  }
}

main()
  .catch((err) => {
    console.error('Seed ล้มเหลว:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
