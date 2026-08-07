"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: catches errors thrown by the root layout itself, where
 * app/error.tsx cannot help because the layout it renders inside is the thing
 * that failed. It therefore has to supply its own <html> and <body>.
 *
 * No shared fonts, providers or Tailwind layout classes are used here for the
 * same reason — whatever broke may be exactly those. Styles are inline so this
 * page renders even if the stylesheet never loaded.
 */
const GlobalError = ({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => {
  useEffect(() => {
    console.error("[storefront] root layout error", error);
  }, [error]);

  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          color: "#1e293b",
          background: "#ffffff",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
          ระบบขัดข้องชั่วคราว
        </h1>

        <p
          style={{
            marginTop: "0.75rem",
            maxWidth: "28rem",
            fontSize: "0.875rem",
            lineHeight: 1.7,
            color: "#64748b",
          }}
        >
          ขออภัยครับ ระบบเกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง
          หากยังไม่หายรบกวนติดต่อแอดมิน
        </p>

        {error.digest ? (
          <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#94a3b8" }}>
            รหัสอ้างอิง: {error.digest}
          </p>
        ) : null}

        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "2rem",
            cursor: "pointer",
            borderRadius: "0.5rem",
            border: "none",
            background: "#f97316",
            padding: "0.625rem 1.25rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            color: "#ffffff",
          }}
        >
          ลองใหม่อีกครั้ง
        </button>
      </body>
    </html>
  );
};

export default GlobalError;
