import { redirect } from 'next/navigation';

export default function HomePage() {
  // FR-A01: ทุกการใช้งานเริ่มที่หน้า Login — ดู User Flow หัวข้อ 7.3
  redirect('/login');
}
