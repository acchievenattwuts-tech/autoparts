import Image from "next/image";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";
import { PRINT_BODY_BORDER_CLASS, PRINT_SECTION_BORDER_CLASS, PRINT_SECTION_TOP_BORDER_CLASS } from "./shared";

type PrintSignatureColumn = {
  label: string;
  dateText: string;
  nameText?: string | null;
  showNameLine?: boolean;
  signatureUrl?: string | null;
  signatureAlt?: string;
};

const PrintSignatureGrid = ({
  columns,
  className = "text-center text-xs",
  reserveVerifySpace = false,
}: {
  columns: PrintSignatureColumn[];
  className?: string;
  reserveVerifySpace?: boolean;
}) => (
  <div
    data-print-signatures
    data-print-verify-space={reserveVerifySpace ? "true" : undefined}
    /* The gutter and height that pair this block with the verify badge live in
       print-pagination.css, keyed off data-print-verify-space, so the two frames
       stay the same size. */
    className={`grid gap-0 ${PRINT_SECTION_BORDER_CLASS} ${className}`}
    style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
  >
    {columns.map((column, index) => {
      const signatureSrc = toPublicStorageCdnPath(column.signatureUrl) ?? column.signatureUrl ?? "";

      return (
      <div key={`${column.label}-${index}`} className={index < columns.length - 1 ? `border-r ${PRINT_BODY_BORDER_CLASS}` : ""}>
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
  </div>
);

export default PrintSignatureGrid;
