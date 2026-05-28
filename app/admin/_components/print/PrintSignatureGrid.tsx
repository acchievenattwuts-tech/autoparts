import Image from "next/image";
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
    className={`grid gap-0 ${PRINT_SECTION_BORDER_CLASS} ${reserveVerifySpace ? "print:mr-36" : ""} ${className}`}
    style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
  >
    {columns.map((column, index) => (
      <div key={`${column.label}-${index}`} className={index < columns.length - 1 ? `border-r ${PRINT_BODY_BORDER_CLASS}` : ""}>
        <div className={column.signatureUrl ? "flex h-16 items-end justify-center px-4" : "h-16"}>
          {column.signatureUrl ? (
            <Image
              src={column.signatureUrl}
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
    ))}
  </div>
);

export default PrintSignatureGrid;
