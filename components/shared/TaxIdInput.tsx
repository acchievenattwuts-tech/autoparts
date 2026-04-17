"use client";

import { useId, useMemo, useState } from "react";
import {
  getTaxIdValidationMessage,
  sanitizeTaxId,
  TAX_ID_INVALID_MESSAGE,
  TAX_ID_LENGTH,
} from "@/lib/tax-id";

type TaxIdInputProps = {
  name: string;
  defaultValue?: string | null;
  className: string;
  placeholder?: string;
};

const TaxIdInput = ({
  name,
  defaultValue = "",
  className,
  placeholder = "13 หลัก",
}: TaxIdInputProps) => {
  const helperId = useId();
  const sanitizedDefaultValue = useMemo(() => sanitizeTaxId(defaultValue), [defaultValue]);
  const [messageState, setMessageState] = useState({
    rawValue: sanitizedDefaultValue,
    text: "",
  });
  const message =
    messageState.rawValue === sanitizedDefaultValue ? messageState.text : "";

  const applyValidity = (nextRawValue: string, input: HTMLInputElement) => {
    const nextMessage = getTaxIdValidationMessage(nextRawValue);
    input.setCustomValidity(nextMessage);
    setMessageState({
      rawValue: sanitizeTaxId(nextRawValue),
      text: nextMessage,
    });
  };

  return (
    <div>
      <input
        key={sanitizedDefaultValue}
        type="text"
        name={name}
        inputMode="numeric"
        autoComplete="off"
        pattern={`\\d{${TAX_ID_LENGTH}}`}
        title={TAX_ID_INVALID_MESSAGE}
        defaultValue={sanitizedDefaultValue}
        className={className}
        placeholder={placeholder}
        aria-describedby={message ? helperId : undefined}
        onChange={(e) => {
          const nextValue = sanitizeTaxId(e.target.value);
          e.target.value = nextValue;
          applyValidity(e.target.value, e.target);
        }}
        onBlur={(e) => {
          applyValidity(e.target.value, e.target);
          if (e.target.validationMessage) {
            e.target.reportValidity();
          }
        }}
      />
      {message ? (
        <p id={helperId} className="mt-1 text-xs text-red-500">
          {message}
        </p>
      ) : null}
    </div>
  );
};

export default TaxIdInput;
