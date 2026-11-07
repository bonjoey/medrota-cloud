import type { Config } from 'tailwindcss';

/**
 * ADR-0001: Design Token กลาง — Mobile-First, WCAG 2.1 AA (Contrast >= 4.5:1)
 * สีตาม Shift Type (Color-coded ตามหัวข้อ 7.2 Core UI Components)
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        shift: {
          morning: '#F59E0B', // เช้า
          afternoon: '#3B82F6', // บ่าย
          night: '#4C1D95', // ดึก
          leave: '#9CA3AF', // ลา
          special: '#059669', // เวรพิเศษ
        },
        risk: {
          normal: '#16A34A',
          warning: '#F59E0B',
          critical: '#DC2626',
        },
      },
      fontSize: {
        base: ['14px', '20px'], // ขั้นต่ำ 14px บนมือถือ ตามหัวข้อ 7.1
      },
    },
  },
  plugins: [],
};

export default config;
