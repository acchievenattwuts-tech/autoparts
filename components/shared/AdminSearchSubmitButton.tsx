"use client";

import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

import { useAdminSearchFormPending } from "./AdminSearchForm";

type AdminSearchSubmitButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>;

const AdminSearchSubmitButton = ({
  children,
  className,
  disabled,
  type,
  ...props
}: AdminSearchSubmitButtonProps) => {
  const isPending = useAdminSearchFormPending();

  return (
    <button
      {...props}
      type={type ?? "submit"}
      disabled={disabled || isPending}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#1e3a5f] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#162d4a] disabled:cursor-wait disabled:opacity-80 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400",
        className,
      )}
    >
      {isPending ? <LoaderCircle size={14} className="animate-spin" /> : null}
      {children ?? "ค้นหา"}
    </button>
  );
};

export default AdminSearchSubmitButton;
