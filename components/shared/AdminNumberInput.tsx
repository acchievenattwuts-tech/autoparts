"use client";

import { useEffect, useState, type ComponentProps } from "react";

type AdminNumberInputProps = Omit<ComponentProps<"input">, "type" | "value" | "onChange"> & {
  value: number | null | undefined;
  onValueChange: (value: number) => void;
  fallbackValue?: number;
};

const toInputValue = (value: number | null | undefined) => (value == null ? "" : String(value));

export default function AdminNumberInput({
  value,
  onValueChange,
  fallbackValue = 0,
  onBlur,
  onFocus,
  ...props
}: AdminNumberInputProps) {
  const [draft, setDraft] = useState(() => toInputValue(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(toInputValue(value));
    }
  }, [isFocused, value]);

  const commitValue = (rawValue: string) => {
    const trimmedValue = rawValue.trim();
    if (trimmedValue === "") {
      onValueChange(fallbackValue);
      setDraft(String(fallbackValue));
      return;
    }

    const parsedValue = Number(trimmedValue);
    if (Number.isFinite(parsedValue)) {
      onValueChange(parsedValue);
      setDraft(String(parsedValue));
      return;
    }

    const resetValue = value ?? fallbackValue;
    onValueChange(resetValue);
    setDraft(String(resetValue));
  };

  return (
    <input
      {...props}
      type="number"
      value={draft}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);
        if (nextValue.trim() === "") {
          return;
        }

        const parsedValue = Number(nextValue);
        if (Number.isFinite(parsedValue)) {
          onValueChange(parsedValue);
        }
      }}
      onBlur={(event) => {
        setIsFocused(false);
        commitValue(event.target.value);
        onBlur?.(event);
      }}
    />
  );
}
