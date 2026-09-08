import Image from "next/image";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";
import PrintDocumentVerifyMark from "./PrintDocumentVerifyMark";
import { PRINT_BODY_BORDER_CLASS, PRINT_SECTION_BORDER_CLASS, PRINT_SECTION_TOP_BORDER_CLASS } from "./shared";
import type { PrintDocumentVerifyBadge } from "@/lib/verify-token";

type PrintSignatureColumn = {
  label: string;
  dateText: string;
  nameText?: string | null;
  showNameLine?: boolean;
  signatureUrl?: string | null;
  signatureAlt?: string;
};

/** ความกว้างช่อง QR — ตรงกับ --print-verify-cell-width ใน print-pagination.css */
const VERIFY_CELL_WIDTH = "var(--print-verify-cell-width)";

const PrintSignatureGrid = ({
  columns,
  className = "text-center text-xs",
  verify = null,
}: {
  columns: PrintSignatureColumn[];
  className?: string;
  /** เมื่อส่งมา ป้าย QR ตรวจสอบเอกสารจะเป็นช่องสุดท้ายของตารางนี้ */
  verify?: PrintDocumentVerifyBadge | null;
}) => (
  <div
    data-print-signatures
    className={`grid gap-0 ${PRINT_SECTION_BORDER_CLASS} ${className}`}
    style={{
      gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))${verify ? ` ${VERIFY_CELL_WIDTH}` : ""}`,
    }}
  >
    {columns.map((column, index) => {
      const signatureSrc = toPublicStorageCdnPath(column.signatureUrl) ?? column.signatureUrl ?? "";
      // ช่องสุดท้ายมีเส้นคั่นขวาก็ต่อเมื่อยังมีช่อง QR ต่อท้าย
      const hasDivider = index < columns.length - 1 || Boolean(verify);

      return (
      <div key={`${column.label}-${index}`} className={hasDivider ? `border-r ${PRINT_BODY_BORDER_CLASS}` : ""}>
        <div className={column.signatureUrl ? "flex h-16 items-end justify-center px-4" : "h-16"}>
          {column.signatureUrl ? (
            <Image
              src={signatureSrc}
              alt={column.signatureAlt ?? column.label}
              width={200}
              height={64}
              className="max-h-[64px] w-auto object-contain"
              loading="eager"
              unoptimized
            />
          ) : null}
        </div>
        <div className={`${PRINT_SECTION_TOP_BORDER_CLASS} py-1.5 font-medium text-gray-900`}>{column.label}</div>
        {column.showNameLine ? <div className="px-4 pb-1 text-gray-900">{column.nameText ?? "\u00A0"}</div> : null}
        <div className="px-4 pb-2 text-gray-600">{column.dateText}</div>
      </div>
      );
    })}
    {verify ? <PrintDocumentVerifyMark verify={verify} /> : null}
  </div>
);

export default PrintSignatureGrid;
