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
      (value.includes("EMAXCONN") ||
        value.includes("max client connections reached") ||
        // Pool could not acquire a connection within connectionTimeoutMillis, or
        // the Supabase pgbouncer pooler dropped a pooled connection mid-use. These
        // are transient connection-level failures (not a logic error), so the
        // storefront should degrade to the "busy" page instead of throwing a 500.
        value.includes("Connection terminated due to connection timeout") ||
        value.includes("Connection terminated unexpectedly") ||
        value.includes("timeout exceeded when trying to connect") ||
        value.includes("ECONNRESET") ||
        // Prisma connection-level error codes: P1001 (can't reach DB), P1017 (server closed the connection).
        value === "P1001" ||
        value === "P1017"),
  );
}
