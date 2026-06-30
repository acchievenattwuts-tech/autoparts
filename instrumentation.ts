/**
 * Next.js instrumentation hook — runs once on server startup.
 * Used to initialize background services and scheduled jobs.
 */

import { initializeNotificationCleanupJob } from "@/lib/notification-cleanup-service";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Initialize cron jobs only in Node.js runtime (not Edge)
    initializeNotificationCleanupJob();
  }
}
