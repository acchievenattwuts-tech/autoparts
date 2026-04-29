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
  void children;

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
      {"\u0e04\u0e49\u0e19\u0e2b\u0e32"}
    </button>
  );
};

export default AdminSearchSubmitButton;
