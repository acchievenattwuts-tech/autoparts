import type { ComponentPropsWithoutRef } from "react";

type AdminExportLinkProps = ComponentPropsWithoutRef<"a"> & {
  href: string;
};

/**
 * Native download navigation for admin exports.
 *
 * Export routes perform expensive database reads and write audit records, so
 * they must only run after an explicit click. Do not replace this anchor with
 * next/link: its production prefetch can execute the export in the background.
 */
export default function AdminExportLink({ children, ...props }: AdminExportLinkProps) {
  return <a {...props}>{children}</a>;
}
