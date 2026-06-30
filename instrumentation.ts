/**
 * Next.js instrumentation hook — runs once on server startup.
 * Used to initialize background services and scheduled jobs.
 */

import { initializeNotificationCleanupJob } from "@/lib/notification-cleanup-service";

// Temporary diagnostic: capture the full stack trace for the pg
// "Calling client.query() when the client is already executing a query"
// DeprecationWarning. The warning itself carries no call site, so we attach a
// process-level listener that prints the originating stack. Remove once the
// emitting query path is identified and fixed.
let hasInstalledQueryWarningTracer = false;

const installPgQueryWarningTracer = (): void => {
  if (hasInstalledQueryWarningTracer) return;
  hasInstalledQueryWarningTracer = true;

  // Deeper stack so the application call site (not just pg internals) shows up.
  if (Error.stackTraceLimit < 30) {
    Error.stackTraceLimit = 30;
  }

  process.on("warning", (warning) => {
    if (
      warning.name === "DeprecationWarning" &&
      warning.message.includes("client is already executing a query")
    ) {
      console.error(
        "[pg-query-warning-tracer] concurrent client.query() detected\n" +
          (warning.stack ?? warning.message),
      );
    }
  });
};

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    installPgQueryWarningTracer();
    // Initialize cron jobs only in Node.js runtime (not Edge)
    initializeNotificationCleanupJob();
  }
}
