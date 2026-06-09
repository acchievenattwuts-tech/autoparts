import cron from "node-cron";
import { cleanupOldNotifications } from "@/lib/notifications";

/**
 * Initializes a nightly cleanup job (2 AM every day) that removes read
 * notifications older than 30 days. Prevents the table from growing unbounded.
 *
 * Safe to call multiple times — cron tasks only start once.
 */
export function initializeNotificationCleanupJob(): void {
  if (process.env.NODE_ENV === "development") {
    console.log("[notification-cleanup] Initializing nightly cleanup job (2 AM daily)...");
  }

  // Run at 2:00 AM daily (Bangkok time — adjust TZ if needed)
  cron.schedule("0 2 * * *", async () => {
    try {
      const deleted = await cleanupOldNotifications(30);
      if (deleted > 0) {
        console.log(`[notification-cleanup] Deleted ${deleted} old read notifications.`);
      }
    } catch (error) {
      console.error(
        "[notification-cleanup] Job failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  });
}
