import type { CSSProperties, ReactNode } from "react";
import PaginatedPrintPages from "@/components/shared/PaginatedPrintPages";

const DEFAULT_ROOT_STYLE: CSSProperties = { maxWidth: "900px" };

const PrintDocumentRoot = ({
  children,
  rootId,
  rootClassName,
  rootStyle,
}: {
  children: ReactNode;
  rootId?: string;
  rootClassName?: string;
  rootStyle?: CSSProperties;
}) => (
  <div
    data-print-paginated="true"
    id={rootId}
    className={
      rootClassName
        ? `print-document-root relative ${rootClassName}`
        : "print-document-root relative mx-auto bg-white p-8 text-[13px] leading-snug"
    }
    style={rootStyle ?? DEFAULT_ROOT_STYLE}
  >
    <style>{`@page { size: A4; margin: 0; }`}</style>
    <div className="print-pagination-source">{children}</div>
    <PaginatedPrintPages />
  </div>
);

export default PrintDocumentRoot;
