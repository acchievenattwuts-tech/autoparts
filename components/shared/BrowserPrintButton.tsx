"use client";

type BrowserPrintButtonProps = {
  label?: string;
  className?: string;
};

const BrowserPrintButton = ({
  label = "พิมพ์ / บันทึก PDF",
  className = "inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50",
}: BrowserPrintButtonProps) => {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {label}
    </button>
  );
};

export default BrowserPrintButton;
