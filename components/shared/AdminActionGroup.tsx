import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AdminActionGroupProps = {
  children: ReactNode;
  align?: "start" | "end" | "between";
  className?: string;
};

const alignClass = {
  start: "justify-start",
  end: "justify-end",
  between: "justify-between",
} as const;

const AdminActionGroup = ({ children, align = "end", className }: AdminActionGroupProps) => (
  <div className={cn("flex flex-wrap items-center gap-2", alignClass[align], className)}>
    {children}
  </div>
);

export default AdminActionGroup;
