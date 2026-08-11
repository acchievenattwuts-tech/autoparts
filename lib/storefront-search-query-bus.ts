/**
 * ตัวกลางส่งค่าคำค้นจากช่องค้นหาบน header ไปให้แผงกรองสินค้า (ProductFilterBar)
 *
 * ปัญหาเดิม: ช่องค้นหาอยู่บน header (StorefrontHeaderSearch) ส่วนปุ่ม "ตกลง"
 * อยู่ในแผงกรอง (SearchResults) คนละ subtree กัน แผงกรองจึงอ่านคำค้นได้แค่จาก
 * URL — ลูกค้าลบ "508" ทิ้งแล้วกดตกลง q=508 เลยยังค้างอยู่
 *
 * วิธีแก้: เก็บข้อความล่าสุดที่ลูกค้า "พิมพ์เอง" ไว้ในโมดูลนี้ แล้วให้ปุ่มตกลง
 * อ่านค่านี้แทน q เดิมใน URL
 *
 * ประกาศเฉพาะตอนลูกค้าแก้ข้อความจริงเท่านั้น (ไม่ประกาศตอน mount / sync จาก URL)
 * เพราะ StorefrontHeaderSearch render ProductAutocomplete พร้อมกัน 2 ตัว
 * (mobile + desktop) — ถ้าประกาศตอน mount ตัวที่ลูกค้าไม่ได้แตะจะเขียนทับกัน
 */

/** null = ลูกค้ายังไม่ได้แก้ช่องค้นหา → ให้ใช้ค่า q จาก URL ตามเดิม */
let manualQuery: string | null = null;

/** เรียกจากช่องค้นหาหน้าร้านทุกครั้งที่ลูกค้าพิมพ์/ลบข้อความเอง */
export const publishStorefrontSearchQuery = (value: string): void => {
  manualQuery = value.trim();
};

/**
 * คืนคำค้นที่ควรใช้ตอนกด "ตกลง" — ถ้าลูกค้าแก้ช่องค้นหาไว้ให้ใช้ค่านั้น
 * (รวมกรณีลบจนว่าง = ตัด q ออก) ถ้ายังไม่แตะเลยให้ใช้ค่าจาก URL
 */
export const resolveStorefrontSearchQuery = (urlQuery: string): string =>
  manualQuery ?? urlQuery;

/** ล้าง override หลังนำไปใช้แล้ว เพื่อให้รอบถัดไปกลับไปยึด URL เป็นหลัก */
export const clearStorefrontSearchQuery = (): void => {
  manualQuery = null;
};
