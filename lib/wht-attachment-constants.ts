/**
 * ค่าคงที่ของไฟล์แนบหนังสือรับรอง 50 ทวิ
 *
 * แยกออกจาก lib/wht-attachment-storage.ts เพราะไฟล์นั้น import `sharp` (server-only)
 * ถ้า client component ดึงค่าคงที่จากที่นั่นตรง ๆ webpack จะลาก sharp เข้า bundle ฝั่ง browser
 * แล้ว build ล้มทันที — รูปแบบเดียวกับ lib/expense-attachment-constants.ts
 */

export const WHT_ATTACHMENT_ROOT = "wht-attachments";
export const WHT_ATTACHMENT_MAX_FILES = 5;
/** 3MB ต่อไฟล์ เท่ากับไฟล์แนบใบค่าใช้จ่าย */
export const WHT_ATTACHMENT_MAX_FILE_BYTES = 3 * 1024 * 1024;
export const WHT_ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";
