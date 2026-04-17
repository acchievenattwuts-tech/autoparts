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
}: {
  columns: PrintSignatureColumn[];
  className?: string;
}) => (
  <div className={`grid gap-0 ${PRINT_SECTION_BORDER_CLASS} ${className}`} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
    {columns.map((column, index) => (
      <div key={`${column.label}-${index}`} className={index < columns.length - 1 ? `border-r ${PRINT_BODY_BORDER_CLASS}` : ""}>
        <div className={column.signatureUrl ? "flex h-16 items-end justify-center px-4" : "h-16"}>
          {column.signatureUrl ? (
            <img
              src={column.signatureUrl}
              alt={column.signatureAlt ?? column.label}
              className="max-h-[64px] w-auto object-contain"
            />
          ) : null}
        </div>
        <div className={`${PRINT_SECTION_TOP_BORDER_CLASS} py-1.5 font-medium text-gray-700`}>{column.label}</div>
        {column.showNameLine ? <div className="px-4 pb-1 text-gray-700">{column.nameText ?? "\u00A0"}</div> : null}
        <div className="px-4 pb-2 text-gray-400">{column.dateText}</div>
      </div>
    ))}
  </div>
);

export default PrintSignatureGrid;
