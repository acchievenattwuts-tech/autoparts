"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle, XCircle } from "lucide-react";

const AUTO_CLEAR_MS = 5_000;

type Props = {
  f2Applied: string;
  f2Error: string;
};

export const FlashMessage = ({ f2Applied, f2Error }: Props) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!f2Applied && !f2Error) return;
    const timer = setTimeout(() => {
      setVisible(false);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("f2Applied");
      next.delete("f2Error");
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
    }, AUTO_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [f2Applied, f2Error, router, pathname, searchParams]);

  if (!visible || (!f2Applied && !f2Error)) return null;

  return (
    <div className="space-y-2">
      {f2Applied ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-100">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{f2Applied}</span>
        </div>
      ) : null}
      {f2Error ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-100">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{f2Error}</span>
        </div>
      ) : null}
    </div>
  );
};
