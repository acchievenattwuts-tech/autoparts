import type { CSSProperties, ReactNode } from "react";
import PrintReadyMarker from "@/components/shared/PrintReadyMarker";

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
    id={rootId}
    className={
      rootClassName
        ? `print-document-root relative ${rootClassName}`
        : "print-document-root relative mx-auto bg-white p-8 text-[13px] leading-snug"
    }
    style={rootStyle ?? DEFAULT_ROOT_STYLE}
  >
    {children}
    <PrintReadyMarker />
  </div>
);

export default PrintDocumentRoot;
