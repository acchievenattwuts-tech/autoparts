import { LoaderCircle } from "lucide-react";

export default function AdminRouteLoading({ label = "กำลังโหลด..." }: { label?: string }) {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center px-4"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
        <LoaderCircle className="h-9 w-9 animate-spin text-[#1e3a5f] dark:text-sky-400" />
        <p className="font-sarabun text-sm">{label}</p>
      </div>
    </div>
  );
}
