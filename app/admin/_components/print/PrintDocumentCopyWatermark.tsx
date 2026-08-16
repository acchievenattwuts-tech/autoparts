/**
 * ลายน้ำ "ต้นฉบับ / สำเนา" กลางหน้าเอกสาร — แสดงเฉพาะตอนพิมพ์เท่านั้น
 *
 * แยกออกจาก PrintDocumentVerifyMark โดยตั้งใจ เพื่อให้ลายน้ำไม่ผูกกับ DOC_VERIFY_SECRET
 * (เดิมลายน้ำหายทั้งใบถ้า env ไม่ถูกตั้ง) ส่วน QR ตรวจสอบเอกสารยังผูกกับ env เหมือนเดิม
 */
const PrintDocumentCopyWatermark = ({ label }: { label: string }) => (
  <div
    aria-hidden="true"
    className="print-document-copy-watermark pointer-events-none absolute inset-0 z-0 hidden items-center justify-center print:flex"
  >
    <div className="rotate-[-28deg] select-none font-kanit text-7xl font-black tracking-[0.16em] text-slate-900/10">
      {label}
    </div>
  </div>
);

export default PrintDocumentCopyWatermark;
