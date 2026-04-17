import type { CSSProperties, ReactNode } from "react";

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
    className={rootClassName ?? "mx-auto bg-white p-8 text-[13px] leading-snug"}
    style={rootStyle ?? DEFAULT_ROOT_STYLE}
  >
    {children}
  </div>
);

export default PrintDocumentRoot;
