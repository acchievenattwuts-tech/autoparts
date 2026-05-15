"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useTransition, type FormEvent, type FormHTMLAttributes, type ReactNode } from "react";

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
  pendingClassName = "opacity-70",
  ...props
}: AdminSearchFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    const action = form.getAttribute("action");
    const actionUrl = new URL(action && action.length > 0 ? action : window.location.href, window.location.href);
    const formData = new FormData(form);
    const nextParams = new URLSearchParams();

    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") {
        nextParams.append(key, value);
      }
    }

    const nextHref = nextParams.toString()
      ? `${actionUrl.pathname}?${nextParams.toString()}`
      : actionUrl.pathname;

    startTransition(() => {
      router.push(nextHref);
    });
  };

  return (
    <AdminSearchFormContext.Provider value={{ isPending }}>
      <form
        {...props}
        onSubmit={handleSubmit}
        className={cn("space-y-3", className, isPending ? pendingClassName : "")}
      >
        {children}
      </form>
    </AdminSearchFormContext.Provider>
  );
};

export default AdminSearchForm;
