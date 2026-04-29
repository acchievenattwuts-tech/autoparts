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
        "inline-flex items-center gap-2 disabled:cursor-wait disabled:opacity-80",
        className,
      )}
    >
      {isPending ? <LoaderCircle size={14} className="animate-spin" /> : null}
      {children ?? "ค้นหา"}
    </button>
  );
};

export default AdminSearchSubmitButton;
