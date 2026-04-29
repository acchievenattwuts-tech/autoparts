"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useState, type FormHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type AdminSearchFormContextValue = {
  isPending: boolean;
};

const AdminSearchFormContext = createContext<AdminSearchFormContextValue>({
  isPending: false,
});

type AdminSearchFormProps = FormHTMLAttributes<HTMLFormElement> & {
  children: ReactNode;
  pendingClassName?: string;
};

export function useAdminSearchFormPending() {
  return useContext(AdminSearchFormContext).isPending;
}

const AdminSearchForm = ({
  children,
  className,
  onSubmitCapture,
  pendingClassName = "opacity-70",
  ...props
}: AdminSearchFormProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendingTargetKey, setPendingTargetKey] = useState<string | null>(null);
  const searchParamsKey = searchParams.toString();
  const navigationKey = searchParamsKey ? `${pathname}?${searchParamsKey}` : pathname;
  const isPending = pendingTargetKey !== null && pendingTargetKey !== navigationKey;

  return (
    <AdminSearchFormContext.Provider value={{ isPending }}>
      <form
        {...props}
        onSubmitCapture={(event) => {
          const form = event.currentTarget;
          const actionUrl = new URL(form.action || window.location.href, window.location.href);
          const formData = new FormData(form);
          const nextParams = new URLSearchParams();

          for (const [key, value] of formData.entries()) {
            if (typeof value === "string") {
              nextParams.append(key, value);
            }
          }

          const nextTargetKey = nextParams.toString()
            ? `${actionUrl.pathname}?${nextParams.toString()}`
            : actionUrl.pathname;

          setPendingTargetKey(nextTargetKey);
          onSubmitCapture?.(event);
        }}
        className={cn(className, isPending ? pendingClassName : "")}
      >
        {children}
      </form>
    </AdminSearchFormContext.Provider>
  );
};

export default AdminSearchForm;
