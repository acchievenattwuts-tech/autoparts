"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

type FormSubmitButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> & {
  /** Optional extra classes for the spinner icon. */
  spinnerClassName?: string;
};

/**
 * Submit button with built-in pending feedback for Server Action `<form action>`.
 *
 * Mirrors the spinner + disabled UX of AdminSearchSubmitButton, but driven by
 * React's `useFormStatus` so it works for any `<form action={serverAction}>`.
 *
 * In a multi-submit form (e.g. status: ignore / needs-investigation / duplicate),
 * pass `name`+`value`: every button disables while submitting, but only the
 * clicked one shows the spinner.
 */
const FormSubmitButton = ({
  children,
  className,
  disabled,
  type,
  name,
  value,
  spinnerClassName,
  ...props
}: FormSubmitButtonProps) => {
  const { pending, data } = useFormStatus();
  const isActive = pending && (!name || data?.get(name) === value);

  return (
    <button
      {...props}
      name={name}
      value={value}
      type={type ?? "submit"}
      disabled={disabled || pending}
      aria-busy={isActive}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 disabled:cursor-wait disabled:opacity-80",
        className,
      )}
    >
      {isActive ? <LoaderCircle className={cn("h-3.5 w-3.5 shrink-0 animate-spin", spinnerClassName)} /> : null}
      {children}
    </button>
  );
};

export default FormSubmitButton;
