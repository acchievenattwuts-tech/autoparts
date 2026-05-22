import type { ReactNode } from "react";
import ReportsLayoutShell from "./ReportsLayoutShell";

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <ReportsLayoutShell>{children}</ReportsLayoutShell>;
}
