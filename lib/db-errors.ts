export function isDatabaseConnectionExhaustionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    message?: unknown;
    cause?: {
      message?: unknown;
      originalMessage?: unknown;
      originalCode?: unknown;
      code?: unknown;
    };
  };

  const values = [
    candidate.message,
    candidate.cause?.message,
    candidate.cause?.originalMessage,
    candidate.cause?.originalCode,
    candidate.cause?.code,
  ];

  return values.some(
    (value) =>
      typeof value === "string" &&
      (value.includes("EMAXCONN") || value.includes("max client connections reached")),
  );
}
